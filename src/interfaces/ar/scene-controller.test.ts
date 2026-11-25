import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { ObtenerEscenaUseCase } from "../../modules/ar/application/use-cases/obtener-escena.use-case";
import type { GuardarEscenaUseCase } from "../../modules/ar/application/use-cases/guardar-escena.use-case";
import { SceneController, sceneErrorStatus } from "./scene-controller";

const dummyUser: SessionUser = { email: "test@example.com", id: "user-1" };
const VALID_ITEM_ID = "11111111-1111-4111-8111-111111111111";

function createMocks(
  options: { accessOk?: boolean; accessErrorCode?: "package.not_found" | "auth.unauthenticated" } = {},
) {
  const authorizePackageAccess = {
    execute: vi.fn().mockResolvedValue(
      options.accessOk === false
        ? err(
            new DomainError(
              options.accessErrorCode ?? "package.not_found",
              options.accessErrorCode === "auth.unauthenticated"
                ? "Inicia sesión para continuar."
                : "No encontramos este paquete.",
            ),
          )
        : ok(dummyUser),
    ),
  };

  const obtenerEscenaUseCase = {
    execute: vi.fn().mockResolvedValue(
      ok({ packageId: "pkg-1", sceneVersion: 2, transformaciones: [{ itemId: VALID_ITEM_ID, posicion: { x: 1, y: 0, z: 1 }, rotacionDeg: 45 }] }),
    ),
  };

  const guardarEscenaUseCase = {
    execute: vi.fn().mockResolvedValue(ok(3)),
  };

  const logger = { error: vi.fn() };

  const controller = new SceneController(
    authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
    obtenerEscenaUseCase as unknown as ObtenerEscenaUseCase,
    guardarEscenaUseCase as unknown as GuardarEscenaUseCase,
    logger,
  );

  return { authorizePackageAccess, controller, guardarEscenaUseCase, logger, obtenerEscenaUseCase };
}

function putRequest(body: unknown): Request {
  return new Request("https://example.com/api/packages/pkg-1/scene", {
    body: JSON.stringify(body),
    method: "PUT",
  });
}

describe("SceneController.handleGet", () => {
  it("devuelve la escena con 200", async () => {
    const { controller } = createMocks();

    const response = await controller.handleGet(new Request("https://example.com"), "pkg-1");
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      sceneVersion: 2,
      transforms: [{ itemId: VALID_ITEM_ID, rotationDeg: 45, x: 1, y: 0, z: 1 }],
    });
  });

  it("devuelve 404 cuando el paquete no es del usuario", async () => {
    const { controller } = createMocks({ accessOk: false });

    const response = await controller.handleGet(new Request("https://example.com"), "pkg-ajeno");

    expect(response.status).toBe(404);
  });

  it("devuelve 401 sin sesión, sin invocar el caso de uso", async () => {
    const { controller, obtenerEscenaUseCase } = createMocks({
      accessErrorCode: "auth.unauthenticated",
      accessOk: false,
    });

    const response = await controller.handleGet(new Request("https://example.com"), "pkg-1");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("auth.unauthenticated");
    expect(obtenerEscenaUseCase.execute).not.toHaveBeenCalled();
  });

  it("devuelve 500 ante un error de persistencia", async () => {
    const { controller, obtenerEscenaUseCase } = createMocks();
    obtenerEscenaUseCase.execute.mockResolvedValue(
      err(new DomainError("scene.persistence_error", "boom")),
    );

    const response = await controller.handleGet(new Request("https://example.com"), "pkg-1");

    expect(response.status).toBe(500);
  });

  it("devuelve 200 con transforms vacío y sceneVersion 0 cuando el paquete nunca guardó una escena", async () => {
    const { controller, obtenerEscenaUseCase } = createMocks();
    obtenerEscenaUseCase.execute.mockResolvedValue(
      ok({ packageId: "pkg-1", sceneVersion: 0, transformaciones: [] }),
    );

    const response = await controller.handleGet(new Request("https://example.com"), "pkg-1");
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ sceneVersion: 0, transforms: [] });
  });

  it("DECOR-55: un error inesperado se registra con el Logger y el correlationId de la solicitud", async () => {
    const { controller, logger, obtenerEscenaUseCase } = createMocks();
    obtenerEscenaUseCase.execute.mockRejectedValue(new Error("boom"));

    const response = await controller.handleGet(
      new Request("https://example.com", { headers: { "x-correlation-id": "corr-1" } }),
      "pkg-1",
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-correlation-id")).toBe("corr-1");
    expect(logger.error).toHaveBeenCalledWith(
      "scene.unexpected_error",
      expect.objectContaining({ correlationId: "corr-1" }),
    );
  });
});

describe("SceneController.handlePut", () => {
  it("guarda la escena y devuelve 200 con la nueva versión", async () => {
    const { controller, guardarEscenaUseCase } = createMocks();

    const response = await controller.handlePut(
      putRequest({ expectedSceneVersion: 2, transforms: [{ itemId: VALID_ITEM_ID, rotationDeg: 45, x: 1, y: 0, z: 1 }] }),
      "pkg-1",
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ sceneVersion: 3 });
    expect(guardarEscenaUseCase.execute).toHaveBeenCalledWith({
      expectedSceneVersion: 2,
      packageId: "pkg-1",
      transformaciones: [{ itemId: VALID_ITEM_ID, posicion: { x: 1, y: 0, z: 1 }, rotacionDeg: 45 }],
      userId: "user-1",
    });
  });

  it("devuelve 404 cuando el paquete no es del usuario, sin invocar el caso de uso", async () => {
    const { controller, guardarEscenaUseCase } = createMocks({ accessOk: false });

    const response = await controller.handlePut(putRequest({ transforms: [] }), "pkg-ajeno");

    expect(response.status).toBe(404);
    expect(guardarEscenaUseCase.execute).not.toHaveBeenCalled();
  });

  it("devuelve 401 sin sesión, sin invocar el caso de uso", async () => {
    const { controller, guardarEscenaUseCase } = createMocks({
      accessErrorCode: "auth.unauthenticated",
      accessOk: false,
    });

    const response = await controller.handlePut(
      putRequest({ expectedSceneVersion: 0, transforms: [] }),
      "pkg-1",
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("auth.unauthenticated");
    expect(guardarEscenaUseCase.execute).not.toHaveBeenCalled();
  });

  it("devuelve 400 con JSON roto", async () => {
    const { controller } = createMocks();
    const request = new Request("https://example.com/api/packages/pkg-1/scene", {
      body: "{not json",
      method: "PUT",
    });

    const response = await controller.handlePut(request, "pkg-1");

    expect(response.status).toBe(400);
  });

  it("devuelve 400 cuando transforms no es una lista válida", async () => {
    const { controller } = createMocks();

    const response = await controller.handlePut(putRequest({ transforms: "no-list" }), "pkg-1");

    expect(response.status).toBe(400);
  });

  it("devuelve 400 cuando un itemId no es un uuid válido", async () => {
    const { controller } = createMocks();

    const response = await controller.handlePut(
      putRequest({ transforms: [{ itemId: "no-uuid", rotationDeg: 0, x: 0, y: 0, z: 0 }] }),
      "pkg-1",
    );

    expect(response.status).toBe(400);
  });

  it("devuelve 400 cuando expectedSceneVersion no es un entero válido", async () => {
    const { controller } = createMocks();

    const response = await controller.handlePut(
      putRequest({ expectedSceneVersion: -1, transforms: [] }),
      "pkg-1",
    );

    expect(response.status).toBe(400);
  });

  it("devuelve 409 ante conflicto de versión de escena", async () => {
    const { controller, guardarEscenaUseCase } = createMocks();
    guardarEscenaUseCase.execute.mockResolvedValue(
      err(
        new DomainError(
          "scene.version_conflict",
          "La escena cambió mientras guardabas.",
          undefined,
          { currentSceneVersion: 3 },
        ),
      ),
    );

    const response = await controller.handlePut(
      putRequest({ expectedSceneVersion: 1, transforms: [] }),
      "pkg-1",
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      currentSceneVersion: 3,
      error: {
        code: "scene.version_conflict",
        message: "La escena cambió mientras guardabas.",
      },
    });
  });

  it("devuelve 422 ante un límite de dominio excedido", async () => {
    const { controller, guardarEscenaUseCase } = createMocks();
    guardarEscenaUseCase.execute.mockResolvedValue(
      err(new DomainError("ar.scene_position_out_of_bounds", "La posición supera el límite permitido.")),
    );

    const response = await controller.handlePut(
      putRequest({
        expectedSceneVersion: 0,
        transforms: [{ itemId: VALID_ITEM_ID, rotationDeg: 0, x: 999, y: 0, z: 0 }],
      }),
      "pkg-1",
    );

    expect(response.status).toBe(422);
  });

  it("devuelve 404 cuando una unidad no pertenece al paquete", async () => {
    const { controller, guardarEscenaUseCase } = createMocks();
    guardarEscenaUseCase.execute.mockResolvedValue(
      err(new DomainError("scene.item_not_found", "No encontramos alguna de estas unidades en el paquete.")),
    );

    const response = await controller.handlePut(
      putRequest({
        expectedSceneVersion: 0,
        transforms: [{ itemId: VALID_ITEM_ID, rotationDeg: 0, x: 0, y: 0, z: 0 }],
      }),
      "pkg-1",
    );

    expect(response.status).toBe(404);
  });

  it("devuelve 400 cuando expectedSceneVersion está ausente, sin invocar el caso de uso", async () => {
    const { controller, guardarEscenaUseCase } = createMocks();

    const response = await controller.handlePut(
      putRequest({ transforms: [{ itemId: VALID_ITEM_ID, rotationDeg: 0, x: 0, y: 0, z: 0 }] }),
      "pkg-1",
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("scene.invalid_body");
    expect(guardarEscenaUseCase.execute).not.toHaveBeenCalled();
  });

  it("devuelve 400 cuando expectedSceneVersion es explícitamente null, sin invocar el caso de uso", async () => {
    const { controller, guardarEscenaUseCase } = createMocks();

    const response = await controller.handlePut(
      putRequest({ expectedSceneVersion: null, transforms: [] }),
      "pkg-1",
    );

    expect(response.status).toBe(400);
    expect(guardarEscenaUseCase.execute).not.toHaveBeenCalled();
  });

  it("DECOR-55: un 500 de persistencia oculta el detalle y registra scene.request_failed; scene.invalid_body es 400", async () => {
    expect(sceneErrorStatus("scene.invalid_body")).toBe(400);

    const { controller, guardarEscenaUseCase, logger } = createMocks();
    guardarEscenaUseCase.execute.mockResolvedValue(
      err(new DomainError("scene.persistence_error", "Error al guardar la escena", { cause: { code: "XX000", details: "fila" } })),
    );

    const response = await controller.handlePut(putRequest({ expectedSceneVersion: 0, transforms: [] }), "pkg-1");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "No pudimos completar la operación." },
    });
    expect(logger.error).toHaveBeenCalledWith("scene.request_failed", {
      code: "scene.persistence_error",
      component: "SceneController.handlePut",
      correlationId: expect.any(String),
      dbCode: "XX000",
    });
  });
});
