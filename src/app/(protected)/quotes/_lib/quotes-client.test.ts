import { describe, expect, it, vi } from "vitest";

import { createHttpQuotesClient, type QuoteTermsRequest } from "./quotes-client";

const TERMS: QuoteTermsRequest = {
  clientName: "Ana",
  conditions: null,
  depositRateBp: 5_000,
  discountRateBp: 0,
  taxRateBp: 1_900,
  validUntil: "2026-12-01",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });

describe("createHttpQuotesClient (DECOR-51)", () => {
  it("crea la cotización enviando solo los términos", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(201, { id: "q-1", version: 1, totals: {} }));

    const result = await createHttpQuotesClient(fetcher).createQuote("pkg 1", TERMS);

    expect(result).toEqual({ ok: true, value: { id: "q-1", version: 1 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/pkg%201/quotes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(TERMS);
  });

  it("crea una versión nueva en /versions", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(201, { id: "q-2", version: 2 }));

    const result = await createHttpQuotesClient(fetcher).createQuoteVersion("q-1", TERMS);

    expect(result).toEqual({ ok: true, value: { id: "q-2", version: 2 } });
    expect(fetcher.mock.calls[0][0]).toBe("/api/quotes/q-1/versions");
  });

  it("muestra el mensaje del servidor en un 422", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json(422, { error: { code: "quote.invalid_valid_until", message: "La vigencia no puede ser una fecha pasada." } }));

    const result = await createHttpQuotesClient(fetcher).createQuote("pkg-1", TERMS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid");
      expect(result.error.message).toBe("La vigencia no puede ser una fecha pasada.");
    }
  });

  it("un 401 se marca como sesión vencida y un fallo de red como red", async () => {
    const unauthorized = vi.fn().mockResolvedValue(json(401, { error: { code: "auth.unauthenticated", message: "x" } }));
    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const a = await createHttpQuotesClient(unauthorized).createQuote("pkg-1", TERMS);
    const b = await createHttpQuotesClient(offline).createQuote("pkg-1", TERMS);

    expect(!a.ok && a.error.kind).toBe("unauthorized");
    expect(!b.ok && b.error.kind).toBe("network");
  });

  it("una respuesta 201 sin id se trata como error del servidor", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(201, { ok: true }));

    const result = await createHttpQuotesClient(fetcher).createQuote("pkg-1", TERMS);

    expect(!result.ok && result.error.kind).toBe("server");
  });
});
