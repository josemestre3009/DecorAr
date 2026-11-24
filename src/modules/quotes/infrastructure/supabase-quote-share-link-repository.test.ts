import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { QuoteRow } from "./quote-row";
import {
  SupabaseQuoteShareLinkRepository,
  SupabaseSharedQuoteReader,
} from "./supabase-quote-share-link-repository";

vi.mock("server-only", () => ({}));

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const QUOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN_HASH = new Uint8Array(32).fill(7);

const LINK_ROW = {
  createdAt: "2026-11-20T12:00:00Z",
  expiresAt: "2026-12-02T05:00:00Z",
  id: LINK_ID,
  quoteId: QUOTE_ID,
  revokedAt: null,
};

function clientReturning(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("SupabaseQuoteShareLinkRepository (DECOR-53)", () => {
  it("create codifica el hash en hex y mapea la fila", async () => {
    const { client, rpc } = clientReturning(LINK_ROW);

    const result = await new SupabaseQuoteShareLinkRepository(client).create({
      expiresAt: new Date("2026-12-02T05:00:00Z"),
      linkId: LINK_ID,
      ownerId: OWNER,
      quoteId: QUOTE_ID,
      tokenHash: TOKEN_HASH,
    });

    expect(rpc).toHaveBeenCalledWith("create_quote_share_link", {
      p_expires_at: "2026-12-02T05:00:00.000Z",
      p_link_id: LINK_ID,
      p_owner_id: OWNER,
      p_quote_id: QUOTE_ID,
      p_token_hash: `\\x${"07".repeat(32)}`,
    });
    expect(result).toEqual({ ok: true, value: { createdAt: LINK_ROW.createdAt, expiresAt: LINK_ROW.expiresAt, id: LINK_ID, quoteId: QUOTE_ID, revokedAt: null } });
  });

  it("create traduce un código conocido a DomainError sin filtrar el mensaje crudo", async () => {
    const { client } = clientReturning(null, { message: "quote.share_not_allowed" });

    const result = await new SupabaseQuoteShareLinkRepository(client).create({
      expiresAt: new Date(),
      linkId: LINK_ID,
      ownerId: OWNER,
      quoteId: QUOTE_ID,
      tokenHash: TOKEN_HASH,
    });

    expect(!result.ok && result.error.code).toBe("quote.share_not_allowed");
  });

  it("create traduce un código desconocido a quote.persistence_error", async () => {
    const { client } = clientReturning(null, { message: "unexpected database failure" });

    const result = await new SupabaseQuoteShareLinkRepository(client).create({
      expiresAt: new Date(),
      linkId: LINK_ID,
      ownerId: OWNER,
      quoteId: QUOTE_ID,
      tokenHash: TOKEN_HASH,
    });

    expect(!result.ok && result.error.code).toBe("quote.persistence_error");
  });

  it("getActive devuelve null cuando la RPC no encuentra nada", async () => {
    const { client, rpc } = clientReturning(null);

    const result = await new SupabaseQuoteShareLinkRepository(client).getActive({
      ownerId: OWNER,
      quoteId: QUOTE_ID,
    });

    expect(rpc).toHaveBeenCalledWith("get_quote_share_link", { p_owner_id: OWNER, p_quote_id: QUOTE_ID });
    expect(result).toEqual({ ok: true, value: null });
  });

  it("revoke mapea la fila revocada", async () => {
    const revoked = { ...LINK_ROW, revokedAt: "2026-11-21T00:00:00Z" };
    const { client, rpc } = clientReturning(revoked);

    const result = await new SupabaseQuoteShareLinkRepository(client).revoke({
      ownerId: OWNER,
      quoteId: QUOTE_ID,
    });

    expect(rpc).toHaveBeenCalledWith("revoke_quote_share_link", { p_owner_id: OWNER, p_quote_id: QUOTE_ID });
    expect(result.ok && result.value.revokedAt).toBe("2026-11-21T00:00:00Z");
  });
});

const QUOTE_ROW: QuoteRow = {
  client_name: "Ana Pérez",
  conditions: null,
  created_at: "2026-11-18T00:00:00Z",
  deposit_cop: 150000,
  deposit_rate_bp: 5000,
  discount_cop: 30000,
  discount_rate_bp: 1000,
  event_date: "2026-12-12",
  event_name: "Boda de Ana",
  event_type: "boda",
  id: QUOTE_ID,
  package_id: "p-1",
  quote_lines: [
    { line_total_cop: 300000, module_id: "m-arco", name: "Arco floral", position: 1, quantity: 2, unit_price_cop: 150000 },
  ],
  quote_number: 12,
  source_package_version: 4,
  status: "sent",
  status_changed_at: "2026-11-18T00:00:00Z",
  subtotal_cop: 300000,
  tax_cop: 51300,
  tax_rate_bp: 1900,
  total_cop: 321300,
  valid_until: "2026-12-01",
  venue: "Hacienda El Prado",
  version: 2,
};

describe("SupabaseSharedQuoteReader (DECOR-53)", () => {
  it("codifica el hash en hex y reduce la fila al DTO público", async () => {
    const { client, rpc } = clientReturning(QUOTE_ROW);

    const result = await new SupabaseSharedQuoteReader(client).getSharedQuote(TOKEN_HASH);

    expect(rpc).toHaveBeenCalledWith("get_shared_quote", { p_token_hash: `\\x${"07".repeat(32)}` });
    expect(result.ok && result.value).not.toHaveProperty("status");
    expect(result.ok && result.value).not.toHaveProperty("id");
    expect(result.ok && result.value).not.toHaveProperty("packageId");
    expect(result.ok && result.value?.lines[0]).not.toHaveProperty("moduleId");
    expect(result.ok && result.value?.lines[0]).toMatchObject({ name: "Arco floral", quantity: 2 });
    expect(result.ok && result.value?.totals.totalCop).toBe(321300);
  });

  it("devuelve null cuando la RPC no encuentra nada (vencido, revocado o inexistente)", async () => {
    const { client } = clientReturning(null);

    const result = await new SupabaseSharedQuoteReader(client).getSharedQuote(TOKEN_HASH);

    expect(result).toEqual({ ok: true, value: null });
  });

  it("traduce un error de la RPC a DomainError", async () => {
    const { client } = clientReturning(null, { message: "boom" });

    const result = await new SupabaseSharedQuoteReader(client).getSharedQuote(TOKEN_HASH);

    expect(!result.ok && result.error.code).toBe("quote.persistence_error");
  });
});
