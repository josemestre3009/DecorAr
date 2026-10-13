import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { PackageGroupReader, PackageStructure, PackageStructureEditorRepository } from "../../modules/packages/application/ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../../modules/packages/application/ports/package-reader.port";
import { DeletePackageGroupUseCase } from "../../modules/packages/application/use-cases/delete-package-group.use-case";
import { MovePackageItemUseCase } from "../../modules/packages/application/use-cases/move-package-item.use-case";
import { UpdatePackageGroupUseCase } from "../../modules/packages/application/use-cases/update-package-group.use-case";
import { ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import type { AddModuleToPackageUseCase } from "../../modules/packages/application/use-cases/add-module-to-package.use-case";
import type { CreatePackageUseCase } from "../../modules/packages/application/use-cases/create-package.use-case";
import type { RemoveModuleFromPackageUseCase } from "../../modules/packages/application/use-cases/remove-module-from-package.use-case";
import { PackageController } from "./package-controller";

const PKG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PKG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ZONA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UNKNOWN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ITEM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MODULE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const OWNER: SessionUser = { email: "owner@example.com", id: "owner-1" };
const SECOND: SessionUser = { email: "two@example.com", id: "user-2" };

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api/packages", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}

/**
 * Integración HTTP real: `AuthorizePackageAccessUseCase` + los casos de uso
 * reales sobre puertos en memoria, sin mocks del controlador. Verifica que un
 * recurso ajeno o inexistente no produce escrituras ni filtra otro evento.
 */
function setup() {
  const state = {
    currentUser: OWNER as SessionUser | null,
    version: 1,
    writes: [] as string[],
  };

  const packageReader: PackageReader = {
    getItemModuleId: vi.fn(),
    getPackage: vi.fn(async (packageId: string, userId: string) => {
      if (packageId !== PKG || userId !== OWNER.id) return ok(null);
      const detail: PackageDetail = {
        capacityM2: 30,
        clientName: null,
        eventDate: null,
        eventType: null,
        id: PKG,
        items: [{ areaM2: 2, itemId: ITEM, moduleId: MODULE }],
        name: "Evento",
        spaceType: "casa",
        userId: OWNER.id,
        venue: null,
        version: state.version,
      };
      return ok(detail);
    }),
  };

  const groupReader: PackageGroupReader = {
    getStructure: vi.fn(async () => {
      const structure: PackageStructure = {
        groups: [{ groupId: ZONA, name: "Zona", parentGroupId: null }],
        itemGroupIds: { [ITEM]: ZONA },
      };
      return ok(structure);
    }),
  };

  const editor: PackageStructureEditorRepository = {
    updateGroup: vi.fn(async () => {
      state.writes.push("updateGroup");
      state.version += 1;
      return ok(state.version);
    }),
    deleteGroup: vi.fn(async () => {
      state.writes.push("deleteGroup");
      state.version += 1;
      return ok(state.version);
    }),
    moveItem: vi.fn(async () => {
      state.writes.push("moveItem");
      state.version += 1;
      return ok(state.version);
    }),
  };

  const session = { currentUser: async () => state.currentUser };
  const authorizePackageAccess = new AuthorizePackageAccessUseCase(session, {
    findOwnerId: async (packageId: string) => ok(packageId === PKG ? OWNER.id : null),
  });

  const clock = { now: () => new Date("2026-10-12T00:00:00.000Z") };
  const idGenerator = { generate: () => crypto.randomUUID() };

  const controller = new PackageController(
    session,
    authorizePackageAccess,
    { execute: vi.fn() } as unknown as CreatePackageUseCase,
    { execute: vi.fn() } as unknown as AddModuleToPackageUseCase,
    { execute: vi.fn() } as unknown as RemoveModuleFromPackageUseCase,
    {
      deletePackageGroupUseCase: new DeletePackageGroupUseCase(packageReader, groupReader, editor, clock, idGenerator),
      movePackageItemUseCase: new MovePackageItemUseCase(packageReader, groupReader, editor, clock, idGenerator),
      updatePackageGroupUseCase: new UpdatePackageGroupUseCase(packageReader, groupReader, editor),
    },
  );

  return { controller, editor, state };
}

describe("HTTP/integración del editor de zonas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("anónimo: 401 y ninguna escritura", async () => {
    const { controller, editor, state } = setup();
    state.currentUser = null;

    const res = await controller.handleUpdateGroup(
      jsonRequest("PATCH", { expectedVersion: 1, name: "Recepción" }),
      PKG,
      ZONA,
    );

    expect(res.status).toBe(401);
    expect(editor.updateGroup).not.toHaveBeenCalled();
  });

  it("propietario: renombra y persiste una sola escritura", async () => {
    const { controller, editor, state } = setup();

    const res = await controller.handleUpdateGroup(
      jsonRequest("PATCH", { expectedVersion: 1, name: "  Recepción  " }),
      PKG,
      ZONA,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      groupId: ZONA,
      name: "Recepción",
      packageVersion: 2,
      parentGroupId: null,
    });
    expect(editor.updateGroup).toHaveBeenCalledTimes(1);
    expect(state.writes).toEqual(["updateGroup"]);
  });

  it("segundo usuario: 404 en evento ajeno sin escrituras", async () => {
    const { controller, editor, state } = setup();
    state.currentUser = SECOND;

    const res = await controller.handleUpdateGroup(
      jsonRequest("PATCH", { expectedVersion: 1, name: "X" }),
      PKG,
      ZONA,
    );

    expect(res.status).toBe(404);
    expect(editor.updateGroup).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it("evento inexistente: 404 sin revelar y sin escrituras", async () => {
    const { controller, editor } = setup();

    const res = await controller.handleUpdateGroup(
      jsonRequest("PATCH", { expectedVersion: 1, name: "X" }),
      OTHER_PKG,
      ZONA,
    );

    expect(res.status).toBe(404);
    expect(editor.updateGroup).not.toHaveBeenCalled();
  });

  it("zona ajena o inexistente: 404 indistinguible sin escrituras", async () => {
    const { controller, editor } = setup();

    const res = await controller.handleUpdateGroup(
      jsonRequest("PATCH", { expectedVersion: 1, name: "X" }),
      PKG,
      UNKNOWN,
    );

    expect(res.status).toBe(404);
    expect(editor.updateGroup).not.toHaveBeenCalled();
  });

  it("mover item a destino ajeno: 404 sin escrituras", async () => {
    const { controller, editor } = setup();

    const res = await controller.handleMoveItem(
      jsonRequest("PATCH", { expectedVersion: 1, groupId: UNKNOWN }),
      PKG,
      ITEM,
    );

    expect(res.status).toBe(404);
    expect(editor.moveItem).not.toHaveBeenCalled();
  });

  it("item inexistente: 404 sin escrituras", async () => {
    const { controller, editor } = setup();

    const res = await controller.handleMoveItem(
      jsonRequest("PATCH", { expectedVersion: 1, groupId: null }),
      PKG,
      UNKNOWN,
    );

    expect(res.status).toBe(404);
    expect(editor.moveItem).not.toHaveBeenCalled();
  });

  it("propietario mueve la instancia entre zonas y persiste una escritura", async () => {
    const { controller, editor, state } = setup();

    const res = await controller.handleMoveItem(
      jsonRequest("PATCH", { expectedVersion: 1, groupId: null }),
      PKG,
      ITEM,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groupId: null, itemId: ITEM, packageVersion: 2 });
    expect(editor.moveItem).toHaveBeenCalledTimes(1);
    expect(state.writes).toEqual(["moveItem"]);
  });

  it("eliminar zona inexistente: 404 sin escrituras", async () => {
    const { controller, editor } = setup();

    const res = await controller.handleDeleteGroup(
      jsonRequest("DELETE", { expectedVersion: 1, strategy: "delete_contents" }),
      PKG,
      UNKNOWN,
    );

    expect(res.status).toBe(404);
    expect(editor.deleteGroup).not.toHaveBeenCalled();
  });
});
