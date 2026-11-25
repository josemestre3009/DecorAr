import { describe, expect, it, vi } from "vitest";

import { createJsonLogger } from "../../infrastructure/logging/json-logger";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import { QuoteShareLinkController, shareLinkErrorStatus } from "./quote-share-link-controller";

vi.mock("server-only", () => ({}));

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
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
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
    const response = await controller.handleCreate(request(), QUOTE_ID);
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret detail");
  });
});

describe("QuoteShareLinkController logs (DECOR-55)", () => {
  const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJxdW90ZUlkIjoicS0xIn0.c2lnbmF0dXJlLXNlY3JldA";

  async function captureOutput(run: (logger: unknown) => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const capture = (line: unknown) => {
      lines.push(String(line));
    };
    const spies = (["debug", "error", "info", "warn"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(capture),
    );
    try {
      await run(createJsonLogger({ now: () => new Date("2026-11-24T00:00:00Z") }));
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    return lines.join("\n");
  }

  it("crear, leer y revocar con el logger real nunca escriben el token ni la URL pública", async () => {
    const output = await captureOutput(async (logger) => {
      const { controller } = build({
        createQuoteShareLink: { execute: vi.fn().mockResolvedValue(ok({ ...LINK, token: TOKEN })) },
        getQuoteShareLink: { execute: vi.fn().mockRejectedValue(new Error(`fallo leyendo ${TOKEN}`)) },
        logger,
      });

      await controller.handleCreate(request(), QUOTE_ID);
      await controller.handleGet(request("GET"), QUOTE_ID);
      await controller.handleRevoke(request("DELETE"), QUOTE_ID);
    });

    expect(output).toContain("share_link.created");
    expect(output).toContain("share_link.unexpected_error");
    expect(output).toContain("share_link.revoked");
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain("/c/");
  });

  it("un fallo de sesión no escribe la cookie ni el JWT que traiga el error", async () => {
    const output = await captureOutput(async (logger) => {
      const { controller } = build({
        logger,
        sessionGateway: {
          currentUser: vi.fn().mockRejectedValue(new Error(`cookie sb-access-token=${TOKEN} inválida`)),
        },
      });

      await controller.handleCreate(request(), QUOTE_ID);
    });

    expect(output).toContain("quote_access.session_lookup_failed");
    expect(output).not.toContain(TOKEN);
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
