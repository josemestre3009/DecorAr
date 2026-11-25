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

const INTENT = { idempotencyKey: "11111111-1111-4111-8111-111111111111" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });

describe("createHttpQuotesClient (DECOR-51)", () => {
  it("crea la cotización enviando solo los términos", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(201, { id: "q-1", version: 1, totals: {} }));

    const result = await createHttpQuotesClient(fetcher).createQuote("pkg 1", TERMS, INTENT);

    expect(result).toEqual({ ok: true, value: { id: "q-1", version: 1 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/packages/pkg%201/quotes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(TERMS);
    expect(init.headers["Idempotency-Key"]).toBe(INTENT.idempotencyKey);
  });

  it("crea una versión nueva en /versions", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(201, { id: "q-2", version: 2 }));

    const result = await createHttpQuotesClient(fetcher).createQuoteVersion("q-1", TERMS, { ...INTENT, expectedVersion: 1 });

    expect(result).toEqual({ ok: true, value: { id: "q-2", version: 2 } });
    expect(fetcher.mock.calls[0][0]).toBe("/api/quotes/q-1/versions");
  });

  it("DECOR-55: la versión nueva envía expectedVersion y la misma Idempotency-Key", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(201, { id: "q-2", version: 2 }));

    await createHttpQuotesClient(fetcher).createQuoteVersion("q-1", TERMS, { ...INTENT, expectedVersion: 3 });

    const [, init] = fetcher.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ ...TERMS, expectedVersion: 3 });
    expect(init.headers["Idempotency-Key"]).toBe(INTENT.idempotencyKey);
  });

  it("DECOR-55: un 409 de versión muestra el mensaje del servidor para recargar", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json(409, {
        currentVersion: 4,
        error: { code: "quote.version_conflict", message: "La cotización cambió mientras la editabas. Recarga para verla." },
      }),
    );

    const result = await createHttpQuotesClient(fetcher).createQuoteVersion("q-1", TERMS, {
      ...INTENT,
      expectedVersion: 3,
    });

    expect(result).toMatchObject({ error: { code: "quote.version_conflict", status: 409 }, ok: false });
    if (!result.ok) expect(result.error.message).toContain("Recarga");
  });

  it("muestra el mensaje del servidor en un 422", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json(422, { error: { code: "quote.invalid_valid_until", message: "La vigencia no puede ser una fecha pasada." } }));

    const result = await createHttpQuotesClient(fetcher).createQuote("pkg-1", TERMS, INTENT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid");
      expect(result.error.message).toBe("La vigencia no puede ser una fecha pasada.");
    }
  });

  it("un 401 se marca como sesión vencida y un fallo de red como red", async () => {
    const unauthorized = vi.fn().mockResolvedValue(json(401, { error: { code: "auth.unauthenticated", message: "x" } }));
    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const a = await createHttpQuotesClient(unauthorized).createQuote("pkg-1", TERMS, INTENT);
    const b = await createHttpQuotesClient(offline).createQuote("pkg-1", TERMS, INTENT);

    expect(!a.ok && a.error.kind).toBe("unauthorized");
    expect(!b.ok && b.error.kind).toBe("network");
  });

  it("una respuesta 201 sin id se trata como error del servidor", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(201, { ok: true }));

    const result = await createHttpQuotesClient(fetcher).createQuote("pkg-1", TERMS, INTENT);

    expect(!result.ok && result.error.kind).toBe("server");
  });
});

const SHARE_LINK = {
  expiresAt: "2026-12-02T05:00:00.000Z",
  id: "link-1",
  revokedAt: null,
  url: "https://decorar.example/c/token-de-ejemplo",
};

describe("createHttpQuotesClient — enlace público (DECOR-53)", () => {
  it("getShareLink devuelve null cuando no hay enlace activo", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { link: null }));

    const result = await createHttpQuotesClient(fetcher).getShareLink("q-1");

    expect(result).toEqual({ ok: true, value: null });
    expect(fetcher.mock.calls[0][0]).toBe("/api/quotes/q-1/share-link");
  });

  it("getShareLink devuelve el enlace activo", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { link: SHARE_LINK }));

    const result = await createHttpQuotesClient(fetcher).getShareLink("q-1");

    expect(result).toEqual({ ok: true, value: SHARE_LINK });
  });

  it("createShareLink crea el enlace con POST y devuelve la URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(201, SHARE_LINK));

    const result = await createHttpQuotesClient(fetcher).createShareLink("q-1");

    expect(result).toEqual({ ok: true, value: SHARE_LINK });
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
  });

  it("createShareLink rechazado por estado inválido muestra el mensaje del servidor", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json(422, { error: { code: "quote.share_not_allowed", message: "Solo se puede compartir una cotización enviada o aceptada." } }));

    const result = await createHttpQuotesClient(fetcher).createShareLink("q-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("Solo se puede compartir una cotización enviada o aceptada.");
    }
  });

  it("revokeShareLink envía DELETE", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, SHARE_LINK));

    const result = await createHttpQuotesClient(fetcher).revokeShareLink("q-1");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fetcher.mock.calls[0][1].method).toBe("DELETE");
  });

  it("un fallo de red se marca como red en las tres operaciones", async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createHttpQuotesClient(offline);

    expect((await client.getShareLink("q-1")).ok).toBe(false);
    expect((await client.createShareLink("q-1")).ok).toBe(false);
    expect((await client.revokeShareLink("q-1")).ok).toBe(false);
  });
});

describe("createHttpQuotesClient — recorrido V2 (DECOR-49)", () => {
  const SUMMARY = {
    clientName: "Ana",
    createdAt: "2026-11-24T10:00:00Z",
    eventName: "Boda",
    id: "q-1",
    number: 3,
    packageId: "pkg-1",
    status: "draft",
    totalCop: 250000,
    validUntil: "2026-12-01",
    version: 2,
  };

  it("changeStatus envía PATCH con el estado nuevo", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { id: "q 1", status: "sent" }));

    const result = await createHttpQuotesClient(fetcher).changeStatus("q 1", "sent", "draft");

    expect(result).toEqual({ ok: true, value: undefined });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/quotes/q%201/status");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ expectedStatus: "draft", status: "sent" });
  });

  it("changeStatus devuelve el mensaje de una transición rechazada", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json(422, { error: { code: "quote.invalid_status_transition", message: "No se puede pasar." } }),
    );

    const result = await createHttpQuotesClient(fetcher).changeStatus("q-1", "sent", "draft");

    expect(result).toMatchObject({ error: { code: "quote.invalid_status_transition", message: "No se puede pasar." }, ok: false });
  });

  it("listQuotes lee GET /api/quotes sin caché y conserva lo que usa la interfaz", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { quotes: [SUMMARY] }));

    const result = await createHttpQuotesClient(fetcher).listQuotes();

    expect(fetcher).toHaveBeenCalledWith("/api/quotes", expect.objectContaining({ cache: "no-store" }));
    expect(result).toEqual({
      ok: true,
      value: [
        {
          createdAt: "2026-11-24T10:00:00Z",
          id: "q-1",
          number: 3,
          packageId: "pkg-1",
          status: "draft",
          totalCop: 250000,
          validUntil: "2026-12-01",
          version: 2,
        },
      ],
    });
  });

  it("listQuotes acepta una cotización cuyo evento ya no existe", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { quotes: [{ ...SUMMARY, packageId: null }] }));

    const result = await createHttpQuotesClient(fetcher).listQuotes();

    expect(result.ok && result.value[0]?.packageId).toBeNull();
  });

  it.each([
    ["sin lista", {}],
    ["estado desconocido", { quotes: [{ ...SUMMARY, status: "archived" }] }],
    ["total no numérico", { quotes: [{ ...SUMMARY, totalCop: "250000" }] }],
  ])("listQuotes trata una respuesta %s como inesperada", async (_case, body) => {
    const fetcher = vi.fn().mockResolvedValue(json(200, body));

    const result = await createHttpQuotesClient(fetcher).listQuotes();

    expect(result).toMatchObject({ error: { kind: "server" }, ok: false });
  });

  it("listQuotes deja pasar la cancelación al desmontar", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("Aborted", "AbortError");
    const fetcher = vi.fn().mockRejectedValue(abort);

    await expect(createHttpQuotesClient(fetcher).listQuotes(controller.signal)).rejects.toBe(abort);
  });

  it("un fallo de red se marca como red en changeStatus y listQuotes", async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createHttpQuotesClient(offline);

    expect(await client.changeStatus("q-1", "sent", "draft")).toMatchObject({ error: { kind: "network" }, ok: false });
    expect(await client.listQuotes()).toMatchObject({ error: { kind: "network" }, ok: false });
  });
});
