import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseBudgetReader } from "./supabase-budget-reader";

vi.mock("server-only", () => ({}));

function clientReturning(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;

  return { client, query };
}

describe("createSupabaseBudgetReader", () => {
  it("lee el presupuesto del paquete pedido", async () => {
    const { client, query } = clientReturning({
      data: { package_id: "pkg-1", total_cop: 450000, package_version: 3, updated_at: "2026-10-08T00:00:00.000Z" },
      error: null,
    });

    const result = await createSupabaseBudgetReader(client).findByPackage("pkg-1");

    expect(client.from).toHaveBeenCalledWith("budgets");
    expect(query.eq).toHaveBeenCalledWith("package_id", "pkg-1");
    expect(result).toEqual({
      ok: true,
      value: { packageId: "pkg-1", totalCop: 450000, currency: "COP", packageVersion: 3, updatedAt: "2026-10-08T00:00:00.000Z" },
    });
  });

  it("devuelve null cuando el paquete no tiene presupuesto calculado", async () => {
    const { client } = clientReturning({ data: null, error: null });

    expect(await createSupabaseBudgetReader(client).findByPackage("pkg-1")).toEqual({ ok: true, value: null });
  });

  it("traduce el error de PostgREST a budget.persistence_error", async () => {
    const { client } = clientReturning({ data: null, error: { message: "boom" } });
    const result = await createSupabaseBudgetReader(client).findByPackage("pkg-1");

    expect(!result.ok && result.error.code).toBe("budget.persistence_error");
  });
});
