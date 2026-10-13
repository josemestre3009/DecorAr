import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { CreatePackageUseCase } from "../../modules/packages/application/use-cases/create-package.use-case";
import type { AddModuleToPackageUseCase } from "../../modules/packages/application/use-cases/add-module-to-package.use-case";
import type { RemoveModuleFromPackageUseCase } from "../../modules/packages/application/use-cases/remove-module-from-package.use-case";
import { PackageController, type PackageControllerOptions } from "./package-controller";

const PKG = "11111111-1111-4111-8111-111111111111";
const GRP = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";

const dummyUser = { email: "owner@example.com", id: "user-1" };

function createController(options: PackageControllerOptions, currentUser = dummyUser) {
  const sessionGateway = { currentUser: vi.fn().mockResolvedValue(currentUser) };
  const authorizePackageAccess = { execute: vi.fn().mockResolvedValue(ok(dummyUser)) };
  const controller = new PackageController(
    sessionGateway,
    authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
    { execute: vi.fn() } as unknown as CreatePackageUseCase,
    { execute: vi.fn() } as unknown as AddModuleToPackageUseCase,
    { execute: vi.fn() } as unknown as RemoveModuleFromPackageUseCase,
    options,
  );
  return { authorizePackageAccess, controller, sessionGateway };
}

function jsonRequest(url: string, method: string, body: unknown, correlationId?: string): Request {
  return new Request(url, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: correlationId
      ? { "content-type": "application/json", "x-correlation-id": correlationId }
      : { "content-type": "application/json" },
    method,
  });
}

describe("PackageController.handleUpdateGroup (PATCH zona)", () => {
  const updateMocks = (result: ReturnType<typeof ok | typeof err> = ok({
    groupId: GRP,
    name: "Recepción",
    packageVersion: 5,
    parentGroupId: null,
  })) => {
    const updatePackageGroupUseCase = { execute: vi.fn().mockResolvedValue(result) };
    return { ...createController({ updatePackageGroupUseCase }), updatePackageGroupUseCase };
  };

  it("renombra enviando solo el nombre y la correlación", async () => {
    const mocks = updateMocks();

    const res = await mocks.controller.handleUpdateGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", { expectedVersion: 3, name: "Recepción" }, "corr-1"),
      PKG,
      GRP,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBe("corr-1");
    expect(await res.json()).toEqual({ groupId: GRP, name: "Recepción", packageVersion: 5, parentGroupId: null });
    expect(mocks.updatePackageGroupUseCase.execute).toHaveBeenCalledWith({
      correlationId: "corr-1",
      expectedVersion: 3,
      groupId: GRP,
      name: "Recepción",
      packageId: PKG,
      userId: "user-1",
    });
  });

  it("mueve la zona pasando parentGroupId y acepta raíz null", async () => {
    const mocks = updateMocks();

    const res = await mocks.controller.handleUpdateGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", { expectedVersion: 1, parentGroupId: OTHER }),
      PKG,
      GRP,
    );

    expect(res.status).toBe(200);
    expect(mocks.updatePackageGroupUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ parentGroupId: OTHER }),
    );

    const toRoot = await mocks.controller.handleUpdateGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", { expectedVersion: 1, parentGroupId: null }),
      PKG,
      GRP,
    );
    expect(toRoot.status).toBe(200);
    expect(mocks.updatePackageGroupUseCase.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ parentGroupId: null }),
    );
  });

  it("exige 401 y 404 antes de tocar el caso de uso", async () => {
    const anonymous = updateMocks();
    anonymous.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
    );
    const anonRes = await anonymous.controller.handleUpdateGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", { expectedVersion: 1, name: "X" }),
      PKG,
      GRP,
    );
    expect(anonRes.status).toBe(401);
    expect(anonymous.updatePackageGroupUseCase.execute).not.toHaveBeenCalled();

    const foreign = updateMocks();
    foreign.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("package.not_found", "No encontramos este paquete.")),
    );
    const foreignRes = await foreign.controller.handleUpdateGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", { expectedVersion: 1, name: "X" }),
      PKG,
      GRP,
    );
    expect(foreignRes.status).toBe(404);
    expect(foreign.updatePackageGroupUseCase.execute).not.toHaveBeenCalled();
  });

  it("rechaza con 400 cuerpos sin cambio, sin versión o con tipos erróneos", async () => {
    const cases: [unknown, string][] = [
      ["{no-json", "package.invalid_body"],
      [{ expectedVersion: 1 }, "package.invalid_body"],
      [{ expectedVersion: 1, name: 42 }, "package.invalid_body"],
      [{ name: "X" }, "package.invalid_version"],
      [{ expectedVersion: 0, name: "X" }, "package.invalid_version"],
      [{ expectedVersion: 1.5, name: "X" }, "package.invalid_version"],
      [{ expectedVersion: "3", name: "X" }, "package.invalid_version"],
      [{ expectedVersion: 1, parentGroupId: 7 }, "package.invalid_group"],
      [{ expectedVersion: 1, parentGroupId: "   " }, "package.invalid_group"],
      [{ expectedVersion: 1, parentGroupId: "not-a-uuid" }, "package.invalid_group"],
    ];

    for (const [body, code] of cases) {
      const mocks = updateMocks();
      const res = await mocks.controller.handleUpdateGroup(
        jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", body),
        PKG,
        GRP,
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(code);
      expect(mocks.updatePackageGroupUseCase.execute).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["package.invalid_group_name", 422],
    ["package.group_cycle", 422],
    ["package.group_depth_exceeded", 422],
    ["package.capacity_exceeded", 422],
    ["package.group_not_found", 404],
    ["package.not_found", 404],
    ["package.version_conflict", 409],
    ["package.persistence_error", 500],
  ])("traduce %s a %i", async (code, status) => {
    const mocks = updateMocks(err(new DomainError(code, "mensaje")));

    const res = await mocks.controller.handleUpdateGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", { expectedVersion: 1, name: "X" }),
      PKG,
      GRP,
    );

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: { code, message: "mensaje" } });
  });

  it("500 controlado sin caso de uso y ante excepción", async () => {
    const without = createController({});
    expect(
      (await without.controller.handleUpdateGroup(
        jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", { expectedVersion: 1, name: "X" }),
        PKG,
        GRP,
      )).status,
    ).toBe(500);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mocks = updateMocks();
    mocks.updatePackageGroupUseCase.execute.mockRejectedValue(new Error("boom"));
    const thrown = await mocks.controller.handleUpdateGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "PATCH", { expectedVersion: 1, name: "X" }),
      PKG,
      GRP,
    );
    expect(thrown.status).toBe(500);
    expect((await thrown.json()).error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});

describe("PackageController.handleDeleteGroup (DELETE zona)", () => {
  const deleteMocks = (result: ReturnType<typeof ok | typeof err> = ok({
    groupId: GRP,
    packageVersion: 6,
    strategy: "move_to_root",
  })) => {
    const deletePackageGroupUseCase = { execute: vi.fn().mockResolvedValue(result) };
    const drainOutbox = { execute: vi.fn().mockResolvedValue(ok({ claimed: 0, failed: 0, published: 0 })) };
    return {
      ...createController({ deletePackageGroupUseCase, drainOutbox }),
      deletePackageGroupUseCase,
      drainOutbox,
    };
  };

  it("elimina con estrategia, responde 200 y drena la outbox", async () => {
    const mocks = deleteMocks();

    const res = await mocks.controller.handleDeleteGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "DELETE", { expectedVersion: 4, strategy: "delete_contents" }, "corr-del"),
      PKG,
      GRP,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBe("corr-del");
    expect(mocks.deletePackageGroupUseCase.execute).toHaveBeenCalledWith({
      correlationId: "corr-del",
      expectedVersion: 4,
      groupId: GRP,
      packageId: PKG,
      strategy: "delete_contents",
      userId: "user-1",
    });
    expect(mocks.drainOutbox.execute).toHaveBeenCalledTimes(1);
  });

  it("rechaza 400 estrategia ausente o inválida y versión faltante", async () => {
    const cases: [unknown, string][] = [
      [{ expectedVersion: 1 }, "package.invalid_strategy"],
      [{ expectedVersion: 1, strategy: "drop" }, "package.invalid_strategy"],
      [{ strategy: "move_to_root" }, "package.invalid_version"],
    ];

    for (const [body, code] of cases) {
      const mocks = deleteMocks();
      const res = await mocks.controller.handleDeleteGroup(
        jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "DELETE", body),
        PKG,
        GRP,
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(code);
      expect(mocks.deletePackageGroupUseCase.execute).not.toHaveBeenCalled();
      expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["package.version_conflict", 409],
    ["package.group_not_found", 404],
    ["package.not_found", 404],
    ["package.group_cycle", 422],
    ["package.persistence_error", 500],
  ])("traduce %s a %i sin drenar", async (code, status) => {
    const mocks = deleteMocks(err(new DomainError(code, "mensaje")));

    const res = await mocks.controller.handleDeleteGroup(
      jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "DELETE", { expectedVersion: 1, strategy: "move_to_root" }),
      PKG,
      GRP,
    );

    expect(res.status).toBe(status);
    expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
  });

  it("401 anónimo y 500 sin caso de uso", async () => {
    const anonymous = deleteMocks();
    anonymous.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
    );
    expect(
      (await anonymous.controller.handleDeleteGroup(
        jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "DELETE", { expectedVersion: 1, strategy: "move_to_root" }),
        PKG,
        GRP,
      )).status,
    ).toBe(401);

    const without = createController({});
    expect(
      (await without.controller.handleDeleteGroup(
        jsonRequest(`http://localhost/api/packages/${PKG}/groups/${GRP}`, "DELETE", { expectedVersion: 1, strategy: "move_to_root" }),
        PKG,
        GRP,
      )).status,
    ).toBe(500);
  });
});

describe("PackageController.handleMoveItem (PATCH item)", () => {
  const moveMocks = (result: ReturnType<typeof ok | typeof err> = ok({
    groupId: OTHER,
    itemId: ITEM,
    packageVersion: 7,
  })) => {
    const movePackageItemUseCase = { execute: vi.fn().mockResolvedValue(result) };
    const drainOutbox = { execute: vi.fn().mockResolvedValue(ok({ claimed: 0, failed: 0, published: 0 })) };
    return {
      ...createController({ drainOutbox, movePackageItemUseCase }),
      drainOutbox,
      movePackageItemUseCase,
    };
  };

  it("mueve la instancia a una zona válida y drena la outbox", async () => {
    const mocks = moveMocks();

    const res = await mocks.controller.handleMoveItem(
      jsonRequest(`http://localhost/api/packages/${PKG}/items/${ITEM}`, "PATCH", { expectedVersion: 3, groupId: OTHER }, "corr-move"),
      PKG,
      ITEM,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBe("corr-move");
    expect(await res.json()).toEqual({ groupId: OTHER, itemId: ITEM, packageVersion: 7 });
    expect(mocks.movePackageItemUseCase.execute).toHaveBeenCalledWith({
      correlationId: "corr-move",
      expectedVersion: 3,
      groupId: OTHER,
      itemId: ITEM,
      packageId: PKG,
      userId: "user-1",
    });
    expect(mocks.drainOutbox.execute).toHaveBeenCalledTimes(1);
  });

  it("acepta mover a la raíz con groupId null", async () => {
    const mocks = moveMocks(ok({ groupId: null, itemId: ITEM, packageVersion: 8 }));

    const res = await mocks.controller.handleMoveItem(
      jsonRequest(`http://localhost/api/packages/${PKG}/items/${ITEM}`, "PATCH", { expectedVersion: 3, groupId: null }),
      PKG,
      ITEM,
    );

    expect(res.status).toBe(200);
    expect(mocks.movePackageItemUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: null }),
    );
  });

  it("rechaza 400 sin groupId, con uuid mal formado o sin versión", async () => {
    const cases: [unknown, string][] = [
      [{ expectedVersion: 1 }, "package.invalid_body"],
      [{ expectedVersion: 1, groupId: 5 }, "package.invalid_group"],
      [{ expectedVersion: 1, groupId: "no-uuid" }, "package.invalid_group"],
      [{ groupId: OTHER }, "package.invalid_version"],
    ];

    for (const [body, code] of cases) {
      const mocks = moveMocks();
      const res = await mocks.controller.handleMoveItem(
        jsonRequest(`http://localhost/api/packages/${PKG}/items/${ITEM}`, "PATCH", body),
        PKG,
        ITEM,
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(code);
      expect(mocks.movePackageItemUseCase.execute).not.toHaveBeenCalled();
      expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["package.item_not_found", 404],
    ["package.group_not_found", 404],
    ["package.not_found", 404],
    ["package.version_conflict", 409],
    ["package.invalid_group", 400],
    ["package.persistence_error", 500],
  ])("traduce %s a %i", async (code, status) => {
    const mocks = moveMocks(err(new DomainError(code, "mensaje")));

    const res = await mocks.controller.handleMoveItem(
      jsonRequest(`http://localhost/api/packages/${PKG}/items/${ITEM}`, "PATCH", { expectedVersion: 1, groupId: OTHER }),
      PKG,
      ITEM,
    );

    expect(res.status).toBe(status);
    expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
  });

  it("401 anónimo, 404 ajeno y 500 sin caso de uso", async () => {
    const anonymous = moveMocks();
    anonymous.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
    );
    expect(
      (await anonymous.controller.handleMoveItem(
        jsonRequest(`http://localhost/api/packages/${PKG}/items/${ITEM}`, "PATCH", { expectedVersion: 1, groupId: OTHER }),
        PKG,
        ITEM,
      )).status,
    ).toBe(401);

    const foreign = moveMocks();
    foreign.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("package.not_found", "No encontramos este paquete.")),
    );
    const foreignRes = await foreign.controller.handleMoveItem(
      jsonRequest(`http://localhost/api/packages/${PKG}/items/${ITEM}`, "PATCH", { expectedVersion: 1, groupId: OTHER }),
      PKG,
      ITEM,
    );
    expect(foreignRes.status).toBe(404);
    expect(foreign.movePackageItemUseCase.execute).not.toHaveBeenCalled();

    const without = createController({});
    expect(
      (await without.controller.handleMoveItem(
        jsonRequest(`http://localhost/api/packages/${PKG}/items/${ITEM}`, "PATCH", { expectedVersion: 1, groupId: OTHER }),
        PKG,
        ITEM,
      )).status,
    ).toBe(500);
  });
});
