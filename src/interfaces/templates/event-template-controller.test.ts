import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import { EventTemplateController } from "./event-template-controller";

const USER: SessionUser = { email: "a@decorar.test", id: "user-a" };
const TEMPLATE = {
  capacityM2: 80,
  colors: [],
  eventType: "boda",
  id: "tpl-1",
  name: "Boda base",
  notes: "",
  spaceType: "salonSocial" as const,
  style: null,
  updatedAt: "2026-10-12T15:00:00Z",
};
const CREATED = {
  capacityM2: 80,
  colors: [],
  eventType: "boda",
  groupCount: 2,
  id: "tpl-1",
  itemCount: 3,
  name: "Boda base",
  notes: "",
  spaceType: "salonSocial" as const,
  style: null,
};
const EVENT = { ...CREATED, version: 1 };

function build(overrides: Record<string, unknown> = {}) {
  const deps: Record<string, unknown> = {
    authorizePackageAccess: { execute: vi.fn().mockResolvedValue(ok(USER)) },
    createEventTemplate: { execute: vi.fn().mockResolvedValue(ok(CREATED)) },
    defaultHeaders: {},
    deleteEventTemplate: { execute: vi.fn().mockResolvedValue(ok(true)) },
    eventTemplateReader: { getTemplate: vi.fn().mockResolvedValue(ok(TEMPLATE)) },
    instantiateEvent: { execute: vi.fn().mockResolvedValue(ok(EVENT)) },
    listEventTemplates: { execute: vi.fn().mockResolvedValue(ok([TEMPLATE])) },
    renameEventTemplate: { execute: vi.fn().mockResolvedValue(ok({ id: "tpl-1", name: "Nuevo" })) },
    sessionGateway: { currentUser: vi.fn().mockResolvedValue(USER) },
    ...overrides,
  };
  return { controller: new EventTemplateController(deps as never), deps: deps as never };
}

describe("EventTemplateController.handleList", () => {
  it("200 con las plantillas propias y el correlation id", async () => {
    const { controller } = build();
    const response = await controller.handleList(
      new Request("http://localhost/api/event-templates", {
        headers: { "x-correlation-id": "corr-list" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("corr-list");
    expect(await response.json()).toEqual({ templates: [TEMPLATE] });
  });

  it("401 sin sesión", async () => {
    const { controller, deps } = build({
      sessionGateway: { currentUser: vi.fn().mockResolvedValue(null) },
    });
    const response = await controller.handleList(new Request("http://localhost/api/event-templates"));

    expect(response.status).toBe(401);
    expect((deps as { listEventTemplates: { execute: ReturnType<typeof vi.fn> } }).listEventTemplates.execute).not.toHaveBeenCalled();
  });

  it("500 genérico ante un fallo de persistencia", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller } = build({
      listEventTemplates: { execute: vi.fn().mockResolvedValue(err(new DomainError("template.persistence_error", "secret"))) },
    });
    const response = await controller.handleList(new Request("http://localhost/api/event-templates"));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    consoleSpy.mockRestore();
  });
});

describe("EventTemplateController.handleCreate", () => {
  it("valida la propiedad del evento antes de copiar y responde 201", async () => {
    const create = vi.fn().mockResolvedValue(ok(CREATED));
    const authorize = vi.fn().mockResolvedValue(ok(USER));
    const { controller } = build({
      authorizePackageAccess: { execute: authorize },
      createEventTemplate: { execute: create },
    });

    const response = await controller.handleCreate(
      new Request("http://localhost/api/event-templates", {
        body: JSON.stringify({ name: "  Boda base  ", packageId: "pkg-1" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    expect(authorize).toHaveBeenCalledWith("pkg-1");
    expect(create).toHaveBeenCalledWith({ name: "  Boda base  ", packageId: "pkg-1", userId: "user-a" });
  });

  it("un evento ajeno responde 404 y no copia", async () => {
    const create = vi.fn();
    const { controller } = build({
      authorizePackageAccess: { execute: vi.fn().mockResolvedValue(err(new DomainError("package.not_found", "x"))) },
      createEventTemplate: { execute: create },
    });

    const response = await controller.handleCreate(
      new Request("http://localhost/api/event-templates", {
        body: JSON.stringify({ name: "X", packageId: "pkg-ajeno" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("package.not_found");
    expect(create).not.toHaveBeenCalled();
  });

  it("nombre inválido del dominio responde 422", async () => {
    const { controller } = build({
      createEventTemplate: { execute: vi.fn().mockResolvedValue(err(new DomainError("template.invalid_name", "x"))) },
    });

    const response = await controller.handleCreate(
      new Request("http://localhost/api/event-templates", {
        body: JSON.stringify({ name: "", packageId: "pkg-1" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("template.invalid_name");
  });

  it("cuerpo o packageId inválidos responden 400 sin consultar la propiedad", async () => {
    const authorize = vi.fn();
    const { controller } = build({ authorizePackageAccess: { execute: authorize } });

    const invalidBody = await controller.handleCreate(
      new Request("http://localhost/api/event-templates", { body: "no-json", method: "POST" }),
    );
    expect(invalidBody.status).toBe(400);

    const missingPackage = await controller.handleCreate(
      new Request("http://localhost/api/event-templates", {
        body: JSON.stringify({ name: "X" }),
        method: "POST",
      }),
    );
    expect(missingPackage.status).toBe(400);
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("EventTemplateController template-scoped handlers", () => {
  it("handleGet devuelve la plantilla del propietario", async () => {
    const { controller } = build();
    const response = await controller.handleGet(new Request("http://localhost/api/event-templates/tpl-1"), "tpl-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TEMPLATE);
  });

  it("handleGet de una plantilla ajena responde 404", async () => {
    const { controller } = build({
      eventTemplateReader: { getTemplate: vi.fn().mockResolvedValue(ok(null)) },
    });
    const response = await controller.handleGet(new Request("http://localhost/api/event-templates/tpl-x"), "tpl-x");

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("template.not_found");
  });

  it("handleRename delega en el caso de uso y responde 200", async () => {
    const rename = vi.fn().mockResolvedValue(ok({ id: "tpl-1", name: "Nuevo" }));
    const { controller } = build({ renameEventTemplate: { execute: rename } });

    const response = await controller.handleRename(
      new Request("http://localhost/api/event-templates/tpl-1", {
        body: JSON.stringify({ name: "Nuevo" }),
        method: "PATCH",
      }),
      "tpl-1",
    );

    expect(response.status).toBe(200);
    expect(rename).toHaveBeenCalledWith({ name: "Nuevo", templateId: "tpl-1", userId: "user-a" });
  });

  it("handleRename propaga el 422 de nombre inválido", async () => {
    const { controller } = build({
      renameEventTemplate: { execute: vi.fn().mockResolvedValue(err(new DomainError("template.invalid_name", "x"))) },
    });

    const response = await controller.handleRename(
      new Request("http://localhost/api/event-templates/tpl-1", {
        body: JSON.stringify({ name: "" }),
        method: "PATCH",
      }),
      "tpl-1",
    );

    expect(response.status).toBe(422);
  });

  it("handleDelete responde 204", async () => {
    const remove = vi.fn().mockResolvedValue(ok(true));
    const { controller } = build({ deleteEventTemplate: { execute: remove } });

    const response = await controller.handleDelete(
      new Request("http://localhost/api/event-templates/tpl-1", { method: "DELETE" }),
      "tpl-1",
    );

    expect(response.status).toBe(204);
    expect(remove).toHaveBeenCalledWith({ templateId: "tpl-1", userId: "user-a" });
  });

  it("handleInstantiate responde 201 con el evento creado", async () => {
    const instantiate = vi.fn().mockResolvedValue(ok(EVENT));
    const { controller } = build({ instantiateEvent: { execute: instantiate } });

    const response = await controller.handleInstantiate(
      new Request("http://localhost/api/event-templates/tpl-1/instantiate", {
        body: JSON.stringify({ name: "Nuevo evento" }),
        method: "POST",
      }),
      "tpl-1",
    );

    expect(response.status).toBe(201);
    expect(instantiate).toHaveBeenCalledWith({ name: "Nuevo evento", templateId: "tpl-1", userId: "user-a" });
  });

  it("handleInstantiate propaga package.invalid_name como 422", async () => {
    const { controller } = build({
      instantiateEvent: { execute: vi.fn().mockResolvedValue(err(new DomainError("package.invalid_name", "x"))) },
    });

    const response = await controller.handleInstantiate(
      new Request("http://localhost/api/event-templates/tpl-1/instantiate", {
        body: JSON.stringify({ name: "" }),
        method: "POST",
      }),
      "tpl-1",
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("package.invalid_name");
  });

  it("sin sesión, las operaciones sobre plantilla responden 401", async () => {
    const rename = vi.fn();
    const { controller } = build({
      renameEventTemplate: { execute: rename },
      sessionGateway: { currentUser: vi.fn().mockResolvedValue(null) },
    });

    const response = await controller.handleRename(
      new Request("http://localhost/api/event-templates/tpl-1", {
        body: JSON.stringify({ name: "X" }),
        method: "PATCH",
      }),
      "tpl-1",
    );

    expect(response.status).toBe(401);
    expect(rename).not.toHaveBeenCalled();
  });
});
