import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import { QuoteController, quoteErrorStatus } from "./quote-controller";

const USER: SessionUser = { email: "a@decorar.test", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const PACKAGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const QUOTE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const QUOTE = { id: QUOTE_ID, number: 1, packageId: PACKAGE_ID, status: "draft", version: 1 };

function build(overrides: Record<string, unknown> = {}) {
  const deps: Record<string, unknown> = {
    authorizePackageAccess: { execute: vi.fn().mockResolvedValue(ok(USER)) },
    changeQuoteStatus: { execute: vi.fn().mockResolvedValue(ok({ ...QUOTE, status: "sent" })) },
    createQuote: { execute: vi.fn().mockResolvedValue(ok({ quote: QUOTE, replayed: false })) },
    createQuoteVersion: {
      execute: vi.fn().mockResolvedValue(ok({ quote: { ...QUOTE, version: 2 }, replayed: false })),
    },
    defaultHeaders: {},
    listQuotes: { execute: vi.fn().mockResolvedValue(ok([])) },
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    quoteReader: { getQuote: vi.fn().mockResolvedValue(ok(QUOTE)) },
    sessionGateway: { currentUser: vi.fn().mockResolvedValue(USER) },
    ...overrides,
  };
  return { controller: new QuoteController(deps as never), deps: deps as Record<string, Record<string, ReturnType<typeof vi.fn>>> };
}

const IDEMPOTENCY_KEY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const jsonRequest = (url: string, body: unknown, method = "POST", headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-correlation-id": "corr-1", ...headers },
    method,
  });

describe("QuoteController.handleCreate", () => {
  it("201: autoriza el paquete y pasa solo los términos; ignora totales del cliente", async () => {
    const { controller, deps } = build();

    const response = await controller.handleCreate(
      jsonRequest(`/api/packages/${PACKAGE_ID}/quotes`, {
        depositRateBp: 5000,
        subtotalCop: 1,
        taxRateBp: 1900,
        totalCop: 1,
        validUntil: "2026-12-01",
      }),
      PACKAGE_ID,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-correlation-id")).toBe("corr-1");
    expect(deps.authorizePackageAccess.execute).toHaveBeenCalledWith(PACKAGE_ID);
    const call = deps.createQuote.execute.mock.calls[0][0];
    expect(call).toMatchObject({ ownerId: USER.id, packageId: PACKAGE_ID });
    expect(call.terms).not.toHaveProperty("totalCop");
    expect(call.terms).not.toHaveProperty("subtotalCop");
  });

  it("404 si el paquete es ajeno, sin crear nada", async () => {
    const { controller, deps } = build({
      authorizePackageAccess: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("package.not_found", "No encontrado"))),
      },
    });

    const response = await controller.handleCreate(jsonRequest("/x", {}), PACKAGE_ID);

    expect(response.status).toBe(404);
    expect(deps.createQuote.execute).not.toHaveBeenCalled();
  });

  it("401 sin sesión", async () => {
    const { controller } = build({
      authorizePackageAccess: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("auth.unauthenticated", "Inicia sesión"))),
      },
    });
    expect((await controller.handleCreate(jsonRequest("/x", {}), PACKAGE_ID)).status).toBe(401);
  });

  it("400 con un cuerpo que no es objeto JSON", async () => {
    const { controller } = build();
    const response = await controller.handleCreate(jsonRequest("/x", "[1,2]"), PACKAGE_ID);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("quote.invalid_body");
  });

  it("422 con términos inválidos y 409 si el evento cambió", async () => {
    const invalid = build({
      createQuote: { execute: vi.fn().mockResolvedValue(err(new DomainError("quote.invalid_tax", "Impuesto"))) },
    });
    const conflict = build({
      createQuote: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("quote.package_version_conflict", "Cambió"))),
      },
    });

    expect((await invalid.controller.handleCreate(jsonRequest("/x", {}), PACKAGE_ID)).status).toBe(422);
    expect((await conflict.controller.handleCreate(jsonRequest("/x", {}), PACKAGE_ID)).status).toBe(409);
  });

  it("500 sin filtrar el detalle de persistencia", async () => {
    const { controller } = build({
      createQuote: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("quote.persistence_error", "secret detail"))),
      },
    });
    const response = await controller.handleCreate(jsonRequest("/x", {}), PACKAGE_ID);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret detail");
  });
});

describe("QuoteController idempotencia y concurrencia (DECOR-55)", () => {
  it("POST quotes pasa la Idempotency-Key y responde la cotización con 201", async () => {
    const { controller, deps } = build();

    const response = await controller.handleCreate(
      jsonRequest("/x", { validUntil: "2026-12-01" }, "POST", { "Idempotency-Key": IDEMPOTENCY_KEY }),
      PACKAGE_ID,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(QUOTE);
    expect(response.headers.get("idempotent-replayed")).toBeNull();
    expect(deps.createQuote.execute.mock.calls[0][0].idempotencyKey).toBe(IDEMPOTENCY_KEY);
  });

  it("un reintento devuelve la misma cotización, 201 y Idempotent-Replayed: true", async () => {
    const { controller } = build({
      createQuote: { execute: vi.fn().mockResolvedValue(ok({ quote: QUOTE, replayed: true })) },
    });

    const response = await controller.handleCreate(
      jsonRequest("/x", {}, "POST", { "Idempotency-Key": IDEMPOTENCY_KEY }),
      PACKAGE_ID,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("idempotent-replayed")).toBe("true");
    expect(await response.json()).toEqual(QUOTE);
  });

  it("sin clave o con clave inválida → 400; clave reutilizada con otra solicitud → 422", async () => {
    const invalid = build({
      createQuote: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("idempotency.key_invalid", "Falta la clave"))),
      },
    });
    const reused = build({
      createQuote: {
        execute: vi.fn().mockResolvedValue(err(new DomainError("idempotency.key_reused", "Otra solicitud"))),
      },
    });

    const a = await invalid.controller.handleCreate(jsonRequest("/x", {}), PACKAGE_ID);
    const b = await reused.controller.handleCreate(jsonRequest("/x", {}), PACKAGE_ID);

    expect(a.status).toBe(400);
    expect((await a.json()).error.code).toBe("idempotency.key_invalid");
    expect(b.status).toBe(422);
  });

  it("POST versions pasa expectedVersion y la clave; un conflicto → 409 con currentVersion", async () => {
    const conflict = new DomainError("quote.version_conflict", "Recarga", undefined, { currentVersion: 3 });
    const { controller, deps } = build({ createQuoteVersion: { execute: vi.fn().mockResolvedValue(err(conflict)) } });

    const response = await controller.handleCreateVersion(
      jsonRequest("/x", { expectedVersion: 2, validUntil: "2026-12-01" }, "POST", {
        "Idempotency-Key": IDEMPOTENCY_KEY,
      }),
      QUOTE_ID,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      currentVersion: 3,
      error: { code: "quote.version_conflict", message: "Recarga" },
    });
    expect(deps.createQuoteVersion.execute.mock.calls[0][0]).toMatchObject({
      expectedVersion: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("PATCH status con un estado que ya cambió → 409 con currentStatus", async () => {
    const conflict = new DomainError("quote.status_conflict", "Recarga", undefined, { currentStatus: "accepted" });
    const { controller } = build({ changeQuoteStatus: { execute: vi.fn().mockResolvedValue(err(conflict)) } });

    const response = await controller.handleChangeStatus(
      jsonRequest("/x", { expectedStatus: "draft", status: "sent" }, "PATCH"),
      QUOTE_ID,
    );

    expect(response.status).toBe(409);
    expect((await response.json()).currentStatus).toBe("accepted");
  });

  it("un 500 se registra con el Logger sin el detalle crudo de Postgres", async () => {
    const cause = { code: "23505", details: "Key (client_name)=(Ana Pérez)", message: "duplicate key" };
    const { controller, deps } = build({
      createQuote: {
        execute: vi
          .fn()
          .mockResolvedValue(err(new DomainError("quote.persistence_error", "Error en create_quote", { cause }))),
      },
    });

    await controller.handleCreate(jsonRequest("/x", {}), PACKAGE_ID);

    expect(deps.logger.error).toHaveBeenCalledWith("quote.request_failed", {
      code: "quote.persistence_error",
      component: "QuoteController.create",
      correlationId: "corr-1",
      dbCode: "23505",
    });
    expect(JSON.stringify(deps.logger.error.mock.calls)).not.toContain("Ana Pérez");
  });
});

describe("QuoteController lecturas", () => {
  it("GET /api/quotes devuelve las cotizaciones del dueño", async () => {
    const { controller, deps } = build();
    const response = await controller.handleList(new Request("http://localhost/api/quotes"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ quotes: [] });
    expect(deps.listQuotes.execute).toHaveBeenCalledWith(USER.id);
  });

  it("GET /api/quotes sin sesión → 401", async () => {
    const { controller } = build({ sessionGateway: { currentUser: vi.fn().mockResolvedValue(null) } });
    expect((await controller.handleList(new Request("http://localhost/api/quotes"))).status).toBe(401);
  });

  it("GET /api/quotes/{id} devuelve la cotización leída al autorizar", async () => {
    const { controller, deps } = build();
    const response = await controller.handleGet(new Request("http://localhost/x"), QUOTE_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(QUOTE);
    expect(deps.quoteReader.getQuote).toHaveBeenCalledWith(QUOTE_ID, USER.id);
  });

  it("GET de una cotización ajena o con id inválido → 404 indistinguible", async () => {
    const { controller, deps } = build({ quoteReader: { getQuote: vi.fn().mockResolvedValue(ok(null)) } });

    const foreign = await controller.handleGet(new Request("http://localhost/x"), QUOTE_ID);
    const malformed = await controller.handleGet(new Request("http://localhost/x"), "no-es-uuid");

    expect(foreign.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(await foreign.json()).toEqual(await malformed.json());
    expect(deps.quoteReader.getQuote).toHaveBeenCalledTimes(1);
  });
});

describe("QuoteController escrituras sobre una cotización", () => {
  it("POST versions → 201 con la versión ya autorizada", async () => {
    const { controller, deps } = build();
    const response = await controller.handleCreateVersion(
      jsonRequest(`/api/quotes/${QUOTE_ID}/versions`, { taxRateBp: 1900, validUntil: "2026-12-01" }),
      QUOTE_ID,
    );

    expect(response.status).toBe(201);
    expect(deps.createQuoteVersion.execute.mock.calls[0][0]).toMatchObject({ ownerId: USER.id, quote: QUOTE });
  });

  it("PATCH status → 200 con el estado nuevo", async () => {
    const { controller, deps } = build();
    const response = await controller.handleChangeStatus(
      jsonRequest(`/api/quotes/${QUOTE_ID}/status`, { expectedStatus: "draft", status: "sent" }, "PATCH"),
      QUOTE_ID,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("sent");
    expect(deps.changeQuoteStatus.execute).toHaveBeenCalledWith({
      expectedStatus: "draft",
      ownerId: USER.id,
      quote: QUOTE,
      status: "sent",
    });
  });

  it("no escribe sobre una cotización ajena", async () => {
    const { controller, deps } = build({ quoteReader: { getQuote: vi.fn().mockResolvedValue(ok(null)) } });

    const version = await controller.handleCreateVersion(jsonRequest("/x", {}), QUOTE_ID);
    const status = await controller.handleChangeStatus(jsonRequest("/x", { status: "sent" }, "PATCH"), QUOTE_ID);

    expect(version.status).toBe(404);
    expect(status.status).toBe(404);
    expect(deps.createQuoteVersion.execute).not.toHaveBeenCalled();
    expect(deps.changeQuoteStatus.execute).not.toHaveBeenCalled();
  });
});

describe("QuoteController.handleGetPdf (DECOR-52)", () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

  it("200: PDF de la versión guardada, descargable y sin caché", async () => {
    const render = vi.fn().mockResolvedValue(PDF);
    const { controller, deps } = build({ pdfRenderer: { render } });

    const response = await controller.handleGetPdf(
      new Request("http://localhost/x", { headers: { "x-correlation-id": "corr-1" } }),
      QUOTE_ID,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="cotizacion-1-v1.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-length")).toBe("5");
    expect(response.headers.get("x-correlation-id")).toBe("corr-1");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    expect(deps.quoteReader.getQuote).toHaveBeenCalledWith(QUOTE_ID, USER.id);
    expect(render).toHaveBeenCalledWith(QUOTE);
  });

  it("401 sin sesión y 404 si es ajena o el id es inválido, sin generar el PDF", async () => {
    const render = vi.fn();
    const anonymous = build({ pdfRenderer: { render }, sessionGateway: { currentUser: vi.fn().mockResolvedValue(null) } });
    const foreign = build({ pdfRenderer: { render }, quoteReader: { getQuote: vi.fn().mockResolvedValue(ok(null)) } });

    expect((await anonymous.controller.handleGetPdf(new Request("http://localhost/x"), QUOTE_ID)).status).toBe(401);
    expect((await foreign.controller.handleGetPdf(new Request("http://localhost/x"), QUOTE_ID)).status).toBe(404);
    expect((await foreign.controller.handleGetPdf(new Request("http://localhost/x"), "no-es-uuid")).status).toBe(404);
    expect(render).not.toHaveBeenCalled();
  });

  it("500 sin detalles si falla el render", async () => {
    const { controller, deps } = build({ pdfRenderer: { render: vi.fn().mockRejectedValue(new Error("font")) } });

    const response = await controller.handleGetPdf(new Request("http://localhost/x"), QUOTE_ID);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: { code: "internal_error", message: "No pudimos completar la operación." } });
    expect(deps.logger.error).toHaveBeenCalledWith("quote.unexpected_error", expect.objectContaining({ component: "QuoteController.getPdf" }));
  });
});

describe("quoteErrorStatus", () => {
  it.each([
    ["auth.unauthenticated", 401],
    ["quote.not_found", 404],
    ["package.not_found", 404],
    ["quote.package_version_conflict", 409],
    ["quote.snapshot_mismatch", 409],
    ["quote.version_conflict", 409],
    ["quote.status_conflict", 409],
    ["idempotency.key_invalid", 400],
    ["idempotency.key_reused", 422],
    ["quote.invalid_body", 400],
    ["quote.invalid_status_transition", 422],
    ["quote.empty_package", 422],
    ["quote.persistence_error", 500],
  ])("%s → %i", (code, status) => {
    expect(quoteErrorStatus(code)).toBe(status);
  });
});
