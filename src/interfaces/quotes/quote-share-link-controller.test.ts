import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import { QuoteShareLinkController, shareLinkErrorStatus } from "./quote-share-link-controller";

const USER: SessionUser = { email: "a@decorar.test", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const QUOTE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const QUOTE = { id: QUOTE_ID, number: 12, status: "sent", version: 1 };
const LINK = {
  createdAt: "2026-11-20T12:00:00Z",
  expiresAt: "2026-12-02T05:00:00Z",
  id: "link-1",
  quoteId: QUOTE_ID,
  revokedAt: null,
};

function build(overrides: Record<string, unknown> = {}) {
  const deps: Record<string, unknown> = {
    createQuoteShareLink: { execute: vi.fn().mockResolvedValue(ok({ ...LINK, token: "token-abc" })) },
    defaultHeaders: {},
    getQuoteShareLink: { execute: vi.fn().mockResolvedValue(ok({ ...LINK, token: "token-abc" })) },
    publicAppUrl: "https://decorar.example",
    quoteReader: { getQuote: vi.fn().mockResolvedValue(ok(QUOTE)) },
    revokeQuoteShareLink: { execute: vi.fn().mockResolvedValue(ok({ ...LINK, revokedAt: "2026-11-21T00:00:00Z" })) },
    sessionGateway: { currentUser: vi.fn().mockResolvedValue(USER) },
    ...overrides,
  };
  return {
    controller: new QuoteShareLinkController(deps as never),
    deps: deps as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
  };
}

const request = (method = "POST") =>
  new Request(`http://localhost/api/quotes/${QUOTE_ID}/share-link`, {
    headers: { "x-correlation-id": "corr-1" },
    method,
  });

describe("QuoteShareLinkController.handleCreate", () => {
  it("201: crea el enlace y construye la URL pública a partir del token", async () => {
    const { controller, deps } = build();

    const response = await controller.handleCreate(request(), QUOTE_ID);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("x-correlation-id")).toBe("corr-1");
    expect(body.url).toBe("https://decorar.example/c/token-abc");
    expect(body).not.toHaveProperty("token");
    expect(deps.createQuoteShareLink.execute).toHaveBeenCalledWith({ ownerId: USER.id, quote: QUOTE });
  });

  it("404 con una cotización ajena o inexistente, sin crear nada", async () => {
    const { controller, deps } = build({ quoteReader: { getQuote: vi.fn().mockResolvedValue(ok(null)) } });

    const response = await controller.handleCreate(request(), QUOTE_ID);

    expect(response.status).toBe(404);
    expect(deps.createQuoteShareLink.execute).not.toHaveBeenCalled();
  });

  it("401 sin sesión", async () => {
    const { controller } = build({ sessionGateway: { currentUser: vi.fn().mockResolvedValue(null) } });
    expect((await controller.handleCreate(request(), QUOTE_ID)).status).toBe(401);
  });

  it("422 si la cotización no se puede compartir", async () => {
    const { controller } = build({
      createQuoteShareLink: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("quote.share_not_allowed", "No se puede compartir"))),
      },
    });

    const response = await controller.handleCreate(request(), QUOTE_ID);
    expect(response.status).toBe(422);
  });

  it("500 sin filtrar el detalle de persistencia, y nunca el token", async () => {
    const { controller } = build({
      createQuoteShareLink: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("quote.persistence_error", "secret detail"))),
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await controller.handleCreate(request(), QUOTE_ID);
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret detail");
    spy.mockRestore();
  });
});

describe("QuoteShareLinkController.handleGet", () => {
  it("200 con el enlace activo y su URL", async () => {
    const { controller } = build();

    const response = await controller.handleGet(request("GET"), QUOTE_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.link.url).toBe("https://decorar.example/c/token-abc");
    expect(body.link).not.toHaveProperty("token");
  });

  it("200 con link null cuando no hay ninguno activo", async () => {
    const { controller } = build({ getQuoteShareLink: { execute: vi.fn().mockResolvedValue(ok(null)) } });

    const response = await controller.handleGet(request("GET"), QUOTE_ID);

    expect(await response.json()).toEqual({ link: null });
  });

  it("404 con una cotización ajena", async () => {
    const { controller } = build({ quoteReader: { getQuote: vi.fn().mockResolvedValue(ok(null)) } });
    expect((await controller.handleGet(request("GET"), QUOTE_ID)).status).toBe(404);
  });
});

describe("QuoteShareLinkController.handleRevoke", () => {
  it("200 con el enlace revocado", async () => {
    const { controller, deps } = build();

    const response = await controller.handleRevoke(request("DELETE"), QUOTE_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.revokedAt).toBe("2026-11-21T00:00:00Z");
    expect(deps.revokeQuoteShareLink.execute).toHaveBeenCalledWith({ ownerId: USER.id, quoteId: QUOTE_ID });
  });

  it("404 si no hay enlace activo que revocar", async () => {
    const { controller } = build({
      revokeQuoteShareLink: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("quote.share_link_not_found", "No hay enlace"))),
      },
    });

    expect((await controller.handleRevoke(request("DELETE"), QUOTE_ID)).status).toBe(404);
  });

  it("no revoca sobre una cotización ajena", async () => {
    const { controller, deps } = build({ quoteReader: { getQuote: vi.fn().mockResolvedValue(ok(null)) } });

    const response = await controller.handleRevoke(request("DELETE"), QUOTE_ID);

    expect(response.status).toBe(404);
    expect(deps.revokeQuoteShareLink.execute).not.toHaveBeenCalled();
  });
});

describe("shareLinkErrorStatus", () => {
  it.each([
    ["auth.unauthenticated", 401],
    ["quote.not_found", 404],
    ["quote.share_link_not_found", 404],
    ["quote.share_not_allowed", 422],
    ["quote.share_expiry_too_far", 422],
    ["quote.persistence_error", 500],
  ])("%s → %i", (code, status) => {
    expect(shareLinkErrorStatus(code)).toBe(status);
  });
});
