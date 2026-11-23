import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { calculateQuote } from "../domain/quote-totals";
import type { QuoteRow } from "./quote-row";
import { SupabaseQuoteReader } from "./supabase-quote-reader";
import { SupabaseQuoteRepository } from "./supabase-quote-repository";
import { groupItems, SupabaseQuoteSourceReader } from "./supabase-quote-source-reader";

vi.mock("server-only", () => ({}));

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ROW: QuoteRow = {
  client_name: "Ana Pérez",
  conditions: null,
  created_at: "2026-11-18T00:00:00Z",
  deposit_cop: "267750",
  deposit_rate_bp: 5000,
  discount_cop: 50000,
  discount_rate_bp: 1000,
  event_date: "2026-12-20",
  event_name: "Boda Ana",
  event_type: "boda",
  id: "q-1",
  package_id: "p-1",
  quote_lines: [
    { line_total_cop: 200000, module_id: "m-silla", name: "Silla", position: 2, quantity: 10, unit_price_cop: 20000 },
    { line_total_cop: 300000, module_id: "m-arco", name: "Arco", position: 1, quantity: 2, unit_price_cop: 150000 },
  ],
  quote_number: 7,
  source_package_version: 3,
  status: "draft",
  status_changed_at: "2026-11-18T00:00:00Z",
  subtotal_cop: 500000,
  tax_cop: 85500,
  tax_rate_bp: 1900,
  total_cop: 535500,
  valid_until: "2026-12-01",
  venue: "Club",
  version: 2,
};

function queryReturning(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "order"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => result);
  // Await directly (list) resolves to the same result.
  (query as unknown as PromiseLike<unknown>).then = ((resolve: (v: unknown) => void) =>
    resolve(result)) as never;
  return query;
}

describe("SupabaseQuoteReader", () => {
  it("lee una cotización filtrando por id y dueño y mapea el contrato", async () => {
    const query = queryReturning({ data: ROW, error: null });
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;

    const result = await new SupabaseQuoteReader(client).getQuote("q-1", OWNER);

    expect(client.from).toHaveBeenCalledWith("quotes");
    expect(query.eq).toHaveBeenCalledWith("id", "q-1");
    expect(query.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(result.ok && result.value).toMatchObject({
      client: { name: "Ana Pérez" },
      event: { date: "2026-12-20", name: "Boda Ana", type: "boda", venue: "Club" },
      number: 7,
      terms: { depositRateBp: 5000, discountRateBp: 1000, taxRateBp: 1900 },
      totals: {
        depositCop: 267750,
        discountCop: 50000,
        subtotalCop: 500000,
        taxCop: 85500,
        taxableBaseCop: 450000,
        totalCop: 535500,
      },
      version: 2,
    });
    expect(result.ok && result.value?.lines.map((line) => line.position)).toEqual([1, 2]);
  });

  it("uuid mal formado o ausente → null; otro error → persistence_error", async () => {
    const malformed = { from: vi.fn(() => queryReturning({ data: null, error: { code: "22P02", message: "x" } })) };
    const failing = { from: vi.fn(() => queryReturning({ data: null, error: { message: "boom" } })) };

    expect(await new SupabaseQuoteReader(malformed as never).getQuote("nope", OWNER)).toEqual({ ok: true, value: null });
    const result = await new SupabaseQuoteReader(failing as never).getQuote("q-1", OWNER);
    expect(!result.ok && result.error.code).toBe("quote.persistence_error");
  });

  it("lista resúmenes por dueño, más recientes primero", async () => {
    const query = queryReturning({ data: [ROW], error: null });
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;

    const result = await new SupabaseQuoteReader(client).listQuotes(OWNER);

    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result.ok && result.value).toEqual([
      {
        clientName: "Ana Pérez",
        createdAt: "2026-11-18T00:00:00Z",
        eventName: "Boda Ana",
        id: "q-1",
        number: 7,
        packageId: "p-1",
        status: "draft",
        totalCop: 535500,
        validUntil: "2026-12-01",
        version: 2,
      },
    ]);
  });
});

describe("SupabaseQuoteRepository", () => {
  const calculation = calculateQuote(
    [{ moduleId: "m-silla", name: "Silla", quantity: 10, unitPriceCop: 20000 }],
    { depositRateBp: 0, discountRateBp: 0, taxRateBp: 1900 },
  );
  if (!calculation.ok) throw calculation.error;
  const terms = {
    clientName: null,
    conditions: "Pago anticipado",
    depositRateBp: 0,
    discountRateBp: 0,
    taxRateBp: 1900,
    validUntil: "2026-12-01",
  };

  it("create_quote recibe dueño, paquete, versión esperada, términos, totales y líneas", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ROW, error: null });
    const result = await new SupabaseQuoteRepository({ rpc } as unknown as SupabaseClient).create({
      calculation: calculation.value,
      expectedPackageVersion: 3,
      ownerId: OWNER,
      packageId: "p-1",
      terms,
    });

    expect(rpc).toHaveBeenCalledWith("create_quote", {
      p_expected_package_version: 3,
      p_lines: [{ lineTotalCop: 200000, moduleId: "m-silla", name: "Silla", position: 1, quantity: 10, unitPriceCop: 20000 }],
      p_owner_id: OWNER,
      p_package_id: "p-1",
      p_quote: expect.objectContaining({
        conditions: "Pago anticipado",
        subtotalCop: 200000,
        taxCop: 38000,
        taxRateBp: 1900,
        totalCop: 238000,
        validUntil: "2026-12-01",
      }),
    });
    expect(result.ok && result.value.id).toBe("q-1");
  });

  it("create_quote_version y change_quote_status usan el id de la cotización", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ROW, error: null });
    const repository = new SupabaseQuoteRepository({ rpc } as unknown as SupabaseClient);

    await repository.createVersion({
      calculation: calculation.value,
      expectedPackageVersion: 3,
      ownerId: OWNER,
      quoteId: "q-1",
      terms,
    });
    await repository.changeStatus({ ownerId: OWNER, quoteId: "q-1", status: "sent" });

    expect(rpc.mock.calls[0][0]).toBe("create_quote_version");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_quote_id: "q-1" });
    expect(rpc).toHaveBeenLastCalledWith("change_quote_status", {
      p_owner_id: OWNER,
      p_quote_id: "q-1",
      p_status: "sent",
    });
  });

  it("traduce los códigos conocidos y oculta los demás como persistence_error", async () => {
    const known = vi.fn().mockResolvedValue({ data: null, error: { message: "quote.package_version_conflict" } });
    const unknown = vi.fn().mockResolvedValue({ data: null, error: { message: "duplicate key" } });

    const conflict = await new SupabaseQuoteRepository({ rpc: known } as never).changeStatus({
      ownerId: OWNER,
      quoteId: "q-1",
      status: "sent",
    });
    const hidden = await new SupabaseQuoteRepository({ rpc: unknown } as never).changeStatus({
      ownerId: OWNER,
      quoteId: "q-1",
      status: "sent",
    });

    expect(!conflict.ok && conflict.error.code).toBe("quote.package_version_conflict");
    expect(!hidden.ok && hidden.error.code).toBe("quote.persistence_error");
  });
});

describe("SupabaseQuoteSourceReader", () => {
  it("agrupa unidades por módulo con orden estable", () => {
    const result = groupItems([
      { catalog_modules: [{ name: "Silla", price_cop: 20000 }], module_id: "m-silla" },
      { catalog_modules: { name: "Arco", price_cop: "150000" }, module_id: "m-arco" },
      { catalog_modules: { name: "Silla", price_cop: 20000 }, module_id: "m-silla" },
    ]);

    expect(result).toEqual({
      ok: true,
      value: [
        { moduleId: "m-arco", name: "Arco", quantity: 1, unitPriceCop: 150000 },
        { moduleId: "m-silla", name: "Silla", quantity: 2, unitPriceCop: 20000 },
      ],
    });
  });

  it("falla si un elemento no tiene datos de catálogo", () => {
    const result = groupItems([{ catalog_modules: null, module_id: "m-x" }]);
    expect(!result.ok && result.error.code).toBe("quote.persistence_error");
  });

  it("lee el paquete del dueño y sus elementos", async () => {
    const pkgQuery = queryReturning({ data: { id: "p-1", version: 4 }, error: null });
    const itemsQuery = queryReturning({
      data: [{ catalog_modules: { name: "Silla", price_cop: 20000 }, module_id: "m-silla" }],
      error: null,
    });
    const from = vi.fn((table: string) => (table === "packages" ? pkgQuery : itemsQuery));

    const result = await new SupabaseQuoteSourceReader({ from } as unknown as SupabaseClient).read("p-1", OWNER);

    expect(pkgQuery.eq).toHaveBeenCalledWith("user_id", OWNER);
    expect(itemsQuery.eq).toHaveBeenCalledWith("package_id", "p-1");
    expect(result).toEqual({
      ok: true,
      value: {
        lines: [{ moduleId: "m-silla", name: "Silla", quantity: 1, unitPriceCop: 20000 }],
        packageId: "p-1",
        packageVersion: 4,
      },
    });
  });

  it("paquete ajeno o inexistente → null", async () => {
    const from = vi.fn(() => queryReturning({ data: null, error: null }));
    expect(await new SupabaseQuoteSourceReader({ from } as never).read("p-1", OWNER)).toEqual({ ok: true, value: null });
  });
});
