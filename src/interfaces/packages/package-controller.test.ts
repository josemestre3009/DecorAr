import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { AddModuleToPackageUseCase } from "../../modules/packages/application/use-cases/add-module-to-package.use-case";
import type { AddModuleToGroupUseCase } from "../../modules/packages/application/use-cases/add-module-to-group.use-case";
import type { CreatePackageGroupUseCase } from "../../modules/packages/application/use-cases/create-package-group.use-case";
import { ClonePackageUseCase } from "../../modules/packages/application/use-cases/clone-package.use-case";
import type { CreatePackageUseCase } from "../../modules/packages/application/use-cases/create-package.use-case";
import type { DeletePackageGroupUseCase } from "../../modules/packages/application/use-cases/delete-package-group.use-case";
import type { RemoveModuleFromPackageUseCase } from "../../modules/packages/application/use-cases/remove-module-from-package.use-case";
import type { RenamePackageGroupUseCase } from "../../modules/packages/application/use-cases/rename-package-group.use-case";
import { PackageController } from "./package-controller";


describe("PackageController", () => {
  const dummyUser: SessionUser = { email: "test@example.com", id: "user-1" };

  const createMocks = () => {
    const sessionGateway = {
      currentUser: vi.fn().mockResolvedValue(dummyUser),
    };

    const authorizePackageAccess = {
      execute: vi.fn().mockResolvedValue(ok(dummyUser)),
    };

    const createPackageUseCase = {
      execute: vi.fn().mockResolvedValue(
        ok({ capacityM2: 50, id: "pkg-1", spaceType: "salonSocial" }),
      ),
    };

    const addModuleToPackageUseCase = {
      execute: vi.fn().mockResolvedValue(
        ok({ itemId: "item-1", packageVersion: 2 }),
      ),
    };

    const removeModuleFromPackageUseCase = {
      execute: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const clonePackageUseCase = {
      execute: vi.fn().mockResolvedValue(
        ok({
          capacityM2: 50,
          colors: ["#ffffff"],
          id: "pkg-cloned-1",
          itemCount: 2,
          notes: "Notas clonadas",
          spaceType: "salonSocial",
          style: "bohemio",
          version: 1,
        }),
      ),
    };

    const drainOutbox = {
      execute: vi.fn().mockResolvedValue(ok({ claimed: 1, failed: 0, published: 1 })),
    };

    const controller = new PackageController(
      sessionGateway,
      authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
      createPackageUseCase as unknown as CreatePackageUseCase,
      addModuleToPackageUseCase as unknown as AddModuleToPackageUseCase,
      removeModuleFromPackageUseCase as unknown as RemoveModuleFromPackageUseCase,
      clonePackageUseCase as unknown as ClonePackageUseCase,
      drainOutbox,
    );

    return {
      addModuleToPackageUseCase,
      authorizePackageAccess,
      clonePackageUseCase,
      controller,
      createPackageUseCase,
      drainOutbox,
      removeModuleFromPackageUseCase,
      sessionGateway,
    };
  };

  /** Controlador con las dependencias del Composite (DECOR-25), por objeto de opciones. */
  const createGroupMocks = () => {
    const base = createMocks();

    const createPackageGroupUseCase = {
      execute: vi.fn().mockResolvedValue(
        ok({
          depth: 1,
          groupId: "grp-1",
          itemIds: ["item-a", "item-b"],
          name: "Zona de bienvenida",
          packageVersion: 6,
          parentGroupId: null,
        }),
      ),
    };

    const addModuleToGroupUseCase = {
      execute: vi.fn().mockResolvedValue(ok({ itemId: "item-g", packageVersion: 5 })),
    };

    const controller = new PackageController(
      base.sessionGateway,
      base.authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
      base.createPackageUseCase as unknown as CreatePackageUseCase,
      base.addModuleToPackageUseCase as unknown as AddModuleToPackageUseCase,
      base.removeModuleFromPackageUseCase as unknown as RemoveModuleFromPackageUseCase,
      {
        addModuleToGroupUseCase: addModuleToGroupUseCase as unknown as AddModuleToGroupUseCase,
        createPackageGroupUseCase: createPackageGroupUseCase as unknown as CreatePackageGroupUseCase,
        drainOutbox: base.drainOutbox,
      },
    );

    return { ...base, addModuleToGroupUseCase, controller, createPackageGroupUseCase };
  };

  describe("handleListPackages", () => {
    const createListController = () => {
      const base = createMocks();
      const listOwnedPackagesUseCase = { execute: vi.fn().mockResolvedValue(ok([])) };
      const controller = new PackageController(
        base.sessionGateway,
        base.authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
        base.createPackageUseCase as unknown as CreatePackageUseCase,
        base.addModuleToPackageUseCase as unknown as AddModuleToPackageUseCase,
        base.removeModuleFromPackageUseCase as unknown as RemoveModuleFromPackageUseCase,
        { listOwnedPackagesUseCase },
      );
      return { ...base, controller, listOwnedPackagesUseCase };
    };

    it("devuelve 401 sin sesión y no consulta paquetes", async () => {
      const mocks = createListController();
      mocks.sessionGateway.currentUser.mockResolvedValue(null);

      const response = await mocks.controller.handleListPackages(new Request("http://localhost/api/packages"));

      expect(response.status).toBe(401);
      expect(mocks.listOwnedPackagesUseCase.execute).not.toHaveBeenCalled();
    });

    it("devuelve sólo el listado del usuario con correlation id", async () => {
      const mocks = createListController();
      const packages = [
        { capacityM2: 20, id: "pkg-1", spaceType: "casa", updatedAt: "2026-10-12T15:00:00Z" },
      ];
      mocks.listOwnedPackagesUseCase.execute.mockResolvedValue(ok(packages));

      const response = await mocks.controller.handleListPackages(
        new Request("http://localhost/api/packages", { headers: { "x-correlation-id": "corr-41" } }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-correlation-id")).toBe("corr-41");
      expect(await response.json()).toEqual({ packages });
      expect(mocks.listOwnedPackagesUseCase.execute).toHaveBeenCalledWith("user-1");
    });

    it("oculta el detalle de errores de persistencia", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mocks = createListController();
      mocks.listOwnedPackagesUseCase.execute.mockResolvedValue(
        err(new DomainError("package.persistence_error", "secret database detail")),
      );

      const response = await mocks.controller.handleListPackages(new Request("http://localhost/api/packages"));

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: "internal_error" } });
      consoleSpy.mockRestore();
    });
  });

  describe("handleCreatePackage", () => {
    it("devuelve 401 si no hay usuario autenticado", async () => {
      const mocks = createMocks();
      mocks.sessionGateway.currentUser.mockResolvedValue(null);

      const req = new Request("http://localhost/api/packages", {
        body: JSON.stringify({ capacityM2: 30, spaceType: "casa" }),
        method: "POST",
      });

      const res = await mocks.controller.handleCreatePackage(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("auth.unauthenticated");
    });

    it("devuelve 400 si el cuerpo no es JSON válido", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages", {
        body: "invalid-json",
        method: "POST",
      });

      const res = await mocks.controller.handleCreatePackage(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("package.invalid_body");
    });

    it("devuelve 422 si la validación de espacio o capacidad falla", async () => {
      const mocks = createMocks();
      mocks.createPackageUseCase.execute.mockResolvedValue(
        err(new DomainError("package.invalid_space_type", "Tipo de espacio no soportado")),
      );

      const req = new Request("http://localhost/api/packages", {
        body: JSON.stringify({ capacityM2: 30, spaceType: "invalido" }),
        method: "POST",
      });

      const res = await mocks.controller.handleCreatePackage(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe("package.invalid_space_type");
    });

    it("devuelve 201 y el paquete creado en caso de éxito", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages", {
        body: JSON.stringify({ capacityM2: 50, spaceType: "salonSocial" }),
        method: "POST",
      });

      const res = await mocks.controller.handleCreatePackage(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual({ capacityM2: 50, id: "pkg-1", spaceType: "salonSocial" });
    });

    it("propaga x-correlation-id a la respuesta (DECOR-31)", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages", {
        body: JSON.stringify({ capacityM2: 50, spaceType: "salonSocial" }),
        headers: { "x-correlation-id": "corr-create" },
        method: "POST",
      });

      const res = await mocks.controller.handleCreatePackage(req);

      expect(res.headers.get("x-correlation-id")).toBe("corr-create");
    });
  });

  describe("handleAddItem", () => {
    it("envía quantity al caso de uso y rechaza cantidades inválidas", async () => {
      const mocks = createMocks();
      const valid = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1", quantity: 4 }),
        method: "POST",
      });

      expect((await mocks.controller.handleAddItem(valid, "pkg-1")).status).toBe(201);
      expect(mocks.addModuleToPackageUseCase.execute).toHaveBeenCalledWith(expect.objectContaining({ quantity: 4 }));

      for (const quantity of [0, -1, 1.5, 101, "2"]) {
        const invalid = new Request("http://localhost/api/packages/pkg-1/items", {
          body: JSON.stringify({ moduleId: "mod-1", quantity }),
          method: "POST",
        });
        const response = await mocks.controller.handleAddItem(invalid, "pkg-1");
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe("package.invalid_quantity");
      }
    });

    it("devuelve 401 si checkPackageAccess falla por falta de sesión", async () => {
      const mocks = createMocks();
      mocks.authorizePackageAccess.execute.mockResolvedValue(
        err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
      );

      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("auth.unauthenticated");
    });

    it("devuelve 404 si el paquete es ajeno o inexistente", async () => {
      const mocks = createMocks();
      mocks.authorizePackageAccess.execute.mockResolvedValue(
        err(new DomainError("package.not_found", "No encontramos este paquete.")),
      );

      const req = new Request("http://localhost/api/packages/pkg-ajeno/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-ajeno");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe("package.not_found");
    });

    it("devuelve 400 si falta moduleId en el cuerpo", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({}),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("package.invalid_module");
    });

    it("devuelve 422 si se excede la capacidad del espacio", async () => {
      const mocks = createMocks();
      mocks.addModuleToPackageUseCase.execute.mockResolvedValue(
        err(new DomainError("package.capacity_exceeded", "excede la capacidad del espacio")),
      );

      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-excedente" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe("package.capacity_exceeded");
    });

    it("devuelve 201 y drena la outbox cuando la inserción tiene éxito", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual({ itemId: "item-1", packageVersion: 2 });
      expect(mocks.drainOutbox.execute).toHaveBeenCalled();
    });

    it("propaga x-correlation-id al caso de uso y a la respuesta (DECOR-31)", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        headers: { "x-correlation-id": "corr-from-client" },
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");

      expect(res.headers.get("x-correlation-id")).toBe("corr-from-client");
      expect(mocks.addModuleToPackageUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: "corr-from-client" }),
      );
    });

    it("genera un correlationId cuando el cliente no envía uno", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");

      expect(res.headers.get("x-correlation-id")).toBeTruthy();
    });

    it("devuelve 409 si hay conflicto de versión en la outbox", async () => {
      const mocks = createMocks();
      mocks.addModuleToPackageUseCase.execute.mockResolvedValue(
        err(new DomainError("package.version_conflict", "La versión del paquete cambió")),
      );

      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error.code).toBe("package.version_conflict");
    });

    it("con parentGroupId delega en AddModuleToGroupUseCase (Composite, DECOR-25)", async () => {
      const mocks = createGroupMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: " mod-1 ", parentGroupId: " grupo-1 " }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ itemId: "item-g", packageVersion: 5 });
      expect(mocks.addModuleToGroupUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: "grupo-1",
          moduleId: "mod-1",
          packageId: "pkg-1",
          userId: "user-1",
        }),
      );
      expect(mocks.addModuleToPackageUseCase.execute).not.toHaveBeenCalled();
      expect(mocks.drainOutbox.execute).toHaveBeenCalledTimes(1);
    });

    it("parentGroupId vacío o en blanco devuelve 400 package.invalid_group sin agregar en la raíz", async () => {
      for (const parentGroupId of ["", "   "]) {
        const mocks = createGroupMocks();
        const req = new Request("http://localhost/api/packages/pkg-1/items", {
          body: JSON.stringify({ moduleId: "mod-1", parentGroupId }),
          method: "POST",
        });

        const res = await mocks.controller.handleAddItem(req, "pkg-1");
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe("package.invalid_group");
        expect(mocks.addModuleToPackageUseCase.execute).not.toHaveBeenCalled();
        expect(mocks.addModuleToGroupUseCase.execute).not.toHaveBeenCalled();
      }
    });

    it("sin parentGroupId (ausente o null) sigue usando AddModuleToPackageUseCase", async () => {
      for (const parentGroupId of [undefined, null]) {
        const mocks = createGroupMocks();
        const req = new Request("http://localhost/api/packages/pkg-1/items", {
          body: JSON.stringify({ moduleId: "mod-1", parentGroupId }),
          method: "POST",
        });

        const res = await mocks.controller.handleAddItem(req, "pkg-1");
        expect(res.status).toBe(201);
        expect(mocks.addModuleToPackageUseCase.execute).toHaveBeenCalledTimes(1);
        expect(mocks.addModuleToGroupUseCase.execute).not.toHaveBeenCalled();
      }
    });

    it("parentGroupId que no es texto devuelve 400 package.invalid_group", async () => {
      const mocks = createGroupMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1", parentGroupId: 42 }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("package.invalid_group");
    });

    it("grupo inexistente devuelve 404 package.group_not_found", async () => {
      const mocks = createGroupMocks();
      mocks.addModuleToGroupUseCase.execute.mockResolvedValue(
        err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete.")),
      );
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1", parentGroupId: "grupo-x" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("package.group_not_found");
      expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
    });

    it("con parentGroupId pero sin caso de uso de grupos configurado devuelve 500 controlado", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1", parentGroupId: "grupo-1" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe("internal_error");
      expect(mocks.addModuleToPackageUseCase.execute).not.toHaveBeenCalled();
    });
  });

  describe("handleRemoveItem", () => {
    it("devuelve 400 si itemId es inválido", async () => {
      const mocks = createMocks();
      const res = await mocks.controller.handleRemoveItem("pkg-1", "   ");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("package.invalid_item");
    });

    it("devuelve 404 si el ítem no existe en el paquete", async () => {
      const mocks = createMocks();
      mocks.removeModuleFromPackageUseCase.execute.mockResolvedValue(
        err(new DomainError("package.item_not_found", "No encontramos este elemento en el paquete.")),
      );

      const res = await mocks.controller.handleRemoveItem("pkg-1", "item-inexistente");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe("package.item_not_found");
    });

    it("devuelve 204 y drena la outbox tras eliminar con éxito", async () => {
      const mocks = createMocks();
      const res = await mocks.controller.handleRemoveItem("pkg-1", "item-1");
      expect(res.status).toBe(204);
      expect(mocks.drainOutbox.execute).toHaveBeenCalled();
    });

    it("propaga x-correlation-id del request opcional al caso de uso y a la respuesta (DECOR-31)", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items/item-1", {
        headers: { "x-correlation-id": "corr-remove" },
        method: "DELETE",
      });

      const res = await mocks.controller.handleRemoveItem("pkg-1", "item-1", req);

      expect(res.headers.get("x-correlation-id")).toBe("corr-remove");
      expect(mocks.removeModuleFromPackageUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: "corr-remove" }),
      );
    });

    it("genera un correlationId cuando no se pasa request", async () => {
      const mocks = createMocks();

      const res = await mocks.controller.handleRemoveItem("pkg-1", "item-1");

      expect(res.headers.get("x-correlation-id")).toBeTruthy();
    });
  });

  describe("handleClonePackage", () => {
    it("devuelve 201 con los datos del clon y no drena la outbox (sin eventos prematuros)", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/clone", {
        method: "POST",
      });

      const res = await mocks.controller.handleClonePackage(req, "pkg-1");
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe("pkg-cloned-1");
      expect(data.itemCount).toBe(2);
      expect(mocks.clonePackageUseCase.execute).toHaveBeenCalledWith({
        sourcePackageId: "pkg-1",
        userId: "user-1",
      });
      // La especificación exige que no emita evento de dominio ni drene outbox
      expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
    });

    it("devuelve 401 si no hay usuario autenticado", async () => {
      const mocks = createMocks();
      mocks.authorizePackageAccess.execute.mockResolvedValue(
        err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
      );

      const req = new Request("http://localhost/api/packages/pkg-1/clone", {
        method: "POST",
      });

      const res = await mocks.controller.handleClonePackage(req, "pkg-1");
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("auth.unauthenticated");
      expect(mocks.clonePackageUseCase.execute).not.toHaveBeenCalled();
    });

    it("devuelve 404 si el paquete origen no existe o es ajeno", async () => {
      const mocks = createMocks();
      mocks.authorizePackageAccess.execute.mockResolvedValue(
        err(new DomainError("package.not_found", "No encontramos este paquete de decoración.")),
      );

      const req = new Request("http://localhost/api/packages/pkg-ajeno/clone", {
        method: "POST",
      });

      const res = await mocks.controller.handleClonePackage(req, "pkg-ajeno");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe("package.not_found");
      expect(mocks.clonePackageUseCase.execute).not.toHaveBeenCalled();
    });

    it("devuelve 500 si la persistencia atómica falla", async () => {
      const mocks = createMocks();
      mocks.clonePackageUseCase.execute.mockResolvedValue(
        err(new DomainError("package.persistence_error", "Error de base de datos")),
      );

      const req = new Request("http://localhost/api/packages/pkg-1/clone", {
        method: "POST",
      });

      const res = await mocks.controller.handleClonePackage(req, "pkg-1");
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.code).toBe("package.persistence_error");
    });

    it("funciona con mock duck-typed de ClonePackageUseCase usando objeto de opciones (resuelve F3)", async () => {
      const mocks = createMocks();
      const mockDuckTypedClone = {
        execute: vi.fn().mockResolvedValue(
          ok({
            capacityM2: 25,
            colors: ["#112233"],
            id: "pkg-cloned-duck",
            itemCount: 1,
            notes: "Clon con mock",
            spaceType: "casa",
            style: "minimalista",
            version: 1,
          }),
        ),
      };

      const controller = new PackageController(
        mocks.sessionGateway,
        mocks.authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
        mocks.createPackageUseCase as unknown as CreatePackageUseCase,
        mocks.addModuleToPackageUseCase as unknown as AddModuleToPackageUseCase,
        mocks.removeModuleFromPackageUseCase as unknown as RemoveModuleFromPackageUseCase,
        {
          clonePackageUseCase: mockDuckTypedClone,
          headers: { "x-test-header": "test-value" },
        },
      );

      const req = new Request("http://localhost/api/packages/pkg-1/clone", {
        method: "POST",
      });

      const res = await controller.handleClonePackage(req, "pkg-1");
      expect(res.status).toBe(201);
      expect(res.headers.get("x-test-header")).toBe("test-value");
      const data = await res.json();
      expect(data.id).toBe("pkg-cloned-duck");
      expect(mockDuckTypedClone.execute).toHaveBeenCalledWith({
        sourcePackageId: "pkg-1",
        userId: "user-1",
      });
    });
  });

  describe("handleCreateGroup (Composite, DECOR-25)", () => {
    const groupRequest = (body: unknown) =>
      new Request("http://localhost/api/packages/pkg-1/groups", {
        body: typeof body === "string" ? body : JSON.stringify(body),
        method: "POST",
      });

    it("crea la Zona de bienvenida con sus hojas: 201, drena la outbox", async () => {
      const mocks = createGroupMocks();

      const res = await mocks.controller.handleCreateGroup(
        groupRequest({ children: [{ moduleId: "mod-arco" }, { moduleId: "mod-mesa" }], name: "Zona de bienvenida" }),
        "pkg-1",
      );

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        depth: 1,
        groupId: "grp-1",
        itemIds: ["item-a", "item-b"],
        name: "Zona de bienvenida",
        packageVersion: 6,
        parentGroupId: null,
      });
      expect(mocks.createPackageGroupUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          moduleIds: ["mod-arco", "mod-mesa"],
          name: "Zona de bienvenida",
          packageId: "pkg-1",
          parentGroupId: null,
          userId: "user-1",
        }),
      );
      expect(mocks.drainOutbox.execute).toHaveBeenCalledTimes(1);
    });

    it("propaga x-correlation-id al caso de uso y a la respuesta (DECOR-31)", async () => {
      const mocks = createGroupMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/groups", {
        body: JSON.stringify({ name: "Zona" }),
        headers: { "x-correlation-id": "corr-group" },
        method: "POST",
      });

      const res = await mocks.controller.handleCreateGroup(req, "pkg-1");

      expect(res.status).toBe(201);
      expect(res.headers.get("x-correlation-id")).toBe("corr-group");
      expect(mocks.createPackageGroupUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: "corr-group" }),
      );
    });

    it("un grupo sin hojas no drena la outbox (no hay eventos)", async () => {
      const mocks = createGroupMocks();
      mocks.createPackageGroupUseCase.execute.mockResolvedValue(
        ok({ depth: 2, groupId: "grp-2", itemIds: [], name: "Sub", packageVersion: 3, parentGroupId: "grp-1" }),
      );

      const res = await mocks.controller.handleCreateGroup(
        groupRequest({ name: "Sub", parentGroupId: "grp-1" }),
        "pkg-1",
      );

      expect(res.status).toBe(201);
      expect(mocks.createPackageGroupUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ moduleIds: [], parentGroupId: "grp-1" }),
      );
      expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
    });

    it("rechaza cuerpos inválidos con 400 sin llamar al caso de uso", async () => {
      const cases: [unknown, string][] = [
        ["{no-json", "package.invalid_body"],
        [{ children: [] }, "package.invalid_group_name"],
        [{ name: "X", parentGroupId: 7 }, "package.invalid_group"],
        [{ name: "X", parentGroupId: "" }, "package.invalid_group"],
        [{ name: "X", parentGroupId: "   " }, "package.invalid_group"],
        [{ children: "mesa", name: "X" }, "package.invalid_module"],
        [{ children: [{ id: "mesa" }], name: "X" }, "package.invalid_module"],
      ];

      for (const [body, code] of cases) {
        const mocks = createGroupMocks();
        const res = await mocks.controller.handleCreateGroup(groupRequest(body), "pkg-1");

        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe(code);
        expect(mocks.createPackageGroupUseCase.execute).not.toHaveBeenCalled();
      }
    });

    it.each([
      ["package.group_depth_exceeded", 422],
      ["package.group_cycle", 422],
      ["package.capacity_exceeded", 422],
      ["package.group_not_found", 404],
      ["package.module_not_found", 404],
      ["package.not_found", 404],
      ["package.version_conflict", 409],
      ["package.invalid_group_name", 400],
      ["package.persistence_error", 500],
    ])("traduce %s a %i con el envelope de error", async (code, status) => {
      const mocks = createGroupMocks();
      mocks.createPackageGroupUseCase.execute.mockResolvedValue(err(new DomainError(code, "mensaje")));

      const res = await mocks.controller.handleCreateGroup(groupRequest({ name: "X" }), "pkg-1");

      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: { code, message: "mensaje" } });
      expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
    });

    it("usuario ajeno: 404 desde checkPackageAccess, sin llamar al caso de uso", async () => {
      const mocks = createGroupMocks();
      mocks.authorizePackageAccess.execute.mockResolvedValue(
        err(new DomainError("package.not_found", "No encontramos este paquete de decoración.")),
      );

      const res = await mocks.controller.handleCreateGroup(groupRequest({ name: "X" }), "pkg-de-otro");

      expect(res.status).toBe(404);
      expect(mocks.createPackageGroupUseCase.execute).not.toHaveBeenCalled();
    });

    it("anónimo: 401 desde checkPackageAccess", async () => {
      const mocks = createGroupMocks();
      mocks.authorizePackageAccess.execute.mockResolvedValue(
        err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
      );

      const res = await mocks.controller.handleCreateGroup(groupRequest({ name: "X" }), "pkg-1");

      expect(res.status).toBe(401);
      expect(mocks.createPackageGroupUseCase.execute).not.toHaveBeenCalled();
    });

    it("sin caso de uso configurado o ante una excepción devuelve 500 controlado", async () => {
      const withoutUseCase = createMocks();
      const res = await withoutUseCase.controller.handleCreateGroup(groupRequest({ name: "X" }), "pkg-1");
      expect(res.status).toBe(500);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mocks = createGroupMocks();
      mocks.createPackageGroupUseCase.execute.mockRejectedValue(new Error("boom"));
      const thrown = await mocks.controller.handleCreateGroup(groupRequest({ name: "X" }), "pkg-1");
      expect(thrown.status).toBe(500);
      expect((await thrown.json()).error.code).toBe("internal_error");
      consoleSpy.mockRestore();
    });
  });

  describe("renombrar y eliminar grupos (DECOR-43)", () => {
    const createManageMocks = () => {
      const base = createMocks();
      const renamePackageGroupUseCase = {
        execute: vi.fn().mockResolvedValue(ok({ groupId: "grp-1", name: "Sala", structureVersion: 3 })),
      };
      const deletePackageGroupUseCase = {
        execute: vi.fn().mockResolvedValue(
          ok({ groupId: "grp-1", parentGroupId: null, promotedGroups: 1, promotedItems: 2, structureVersion: 4 }),
        ),
      };
      const controller = new PackageController(
        base.sessionGateway,
        base.authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
        base.createPackageUseCase as unknown as CreatePackageUseCase,
        base.addModuleToPackageUseCase as unknown as AddModuleToPackageUseCase,
        base.removeModuleFromPackageUseCase as unknown as RemoveModuleFromPackageUseCase,
        {
          deletePackageGroupUseCase: deletePackageGroupUseCase as unknown as DeletePackageGroupUseCase,
          drainOutbox: base.drainOutbox,
          renamePackageGroupUseCase: renamePackageGroupUseCase as unknown as RenamePackageGroupUseCase,
        },
      );
      return { ...base, controller, deletePackageGroupUseCase, renamePackageGroupUseCase };
    };

    const patchRequest = (body: unknown, headers: Record<string, string> = {}) =>
      new Request("http://localhost/api/packages/pkg-1/groups/grp-1", {
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers,
        method: "PATCH",
      });

    const deleteRequest = (headers: Record<string, string> = {}) =>
      new Request("http://localhost/api/packages/pkg-1/groups/grp-1", { headers, method: "DELETE" });

    it("PATCH renombra: 200 con el grupo, eco de x-correlation-id y sin drenar la outbox", async () => {
      const mocks = createManageMocks();

      const res = await mocks.controller.handleRenameGroup(
        patchRequest({ name: " Sala " }, { "x-correlation-id": "corr-rename" }),
        "pkg-1",
        "grp-1",
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ groupId: "grp-1", name: "Sala", structureVersion: 3 });
      expect(res.headers.get("x-correlation-id")).toBe("corr-rename");
      expect(mocks.renamePackageGroupUseCase.execute).toHaveBeenCalledWith({
        groupId: "grp-1",
        name: " Sala ",
        packageId: "pkg-1",
        userId: "user-1",
      });
      expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
    });

    it("PATCH rechaza cuerpos inválidos con 400 sin llamar al caso de uso", async () => {
      const cases: [unknown, string][] = [
        ["{no-json", "package.invalid_body"],
        ["null", "package.invalid_body"],
        [{}, "package.invalid_group_name"],
        [{ name: 7 }, "package.invalid_group_name"],
      ];

      for (const [body, code] of cases) {
        const mocks = createManageMocks();
        const res = await mocks.controller.handleRenameGroup(patchRequest(body), "pkg-1", "grp-1");

        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe(code);
        expect(mocks.renamePackageGroupUseCase.execute).not.toHaveBeenCalled();
      }
    });

    it("DELETE elimina: 204 sin cuerpo, eco de x-correlation-id y sin drenar la outbox", async () => {
      const mocks = createManageMocks();

      const res = await mocks.controller.handleDeleteGroup(
        deleteRequest({ "x-correlation-id": "corr-delete" }),
        "pkg-1",
        "grp-1",
      );

      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(res.headers.get("x-correlation-id")).toBe("corr-delete");
      expect(mocks.deletePackageGroupUseCase.execute).toHaveBeenCalledWith({
        groupId: "grp-1",
        packageId: "pkg-1",
        userId: "user-1",
      });
      expect(mocks.drainOutbox.execute).not.toHaveBeenCalled();
    });

    it.each([
      ["package.group_not_found", 404],
      ["package.not_found", 404],
      ["package.version_conflict", 409],
      ["package.group_integrity", 422],
      ["package.invalid_group", 400],
      ["package.invalid_group_name", 400],
      ["package.persistence_error", 500],
    ])("mapea %s a %i en PATCH y DELETE", async (code, status) => {
      const mocks = createManageMocks();
      mocks.renamePackageGroupUseCase.execute.mockResolvedValue(err(new DomainError(code, "falló")));
      mocks.deletePackageGroupUseCase.execute.mockResolvedValue(err(new DomainError(code, "falló")));

      const renamed = await mocks.controller.handleRenameGroup(patchRequest({ name: "X" }), "pkg-1", "grp-1");
      const deleted = await mocks.controller.handleDeleteGroup(deleteRequest(), "pkg-1", "grp-1");

      expect(renamed.status).toBe(status);
      expect(deleted.status).toBe(status);
      expect((await deleted.json()).error.code).toBe(code);
    });

    it("usuario ajeno (404) y anónimo (401) no llegan a los casos de uso", async () => {
      for (const [error, status] of [
        [new DomainError("package.not_found", "No encontramos este paquete."), 404],
        [new DomainError("auth.unauthenticated", "Inicia sesión para continuar."), 401],
      ] as const) {
        const mocks = createManageMocks();
        mocks.authorizePackageAccess.execute.mockResolvedValue(err(error));

        const renamed = await mocks.controller.handleRenameGroup(patchRequest({ name: "X" }), "pkg-1", "grp-1");
        const deleted = await mocks.controller.handleDeleteGroup(deleteRequest(), "pkg-1", "grp-1");

        expect(renamed.status).toBe(status);
        expect(deleted.status).toBe(status);
        expect(mocks.renamePackageGroupUseCase.execute).not.toHaveBeenCalled();
        expect(mocks.deletePackageGroupUseCase.execute).not.toHaveBeenCalled();
      }
    });

    it("sin casos de uso configurados o ante una excepción devuelve 500 controlado", async () => {
      const withoutUseCases = createMocks();
      expect((await withoutUseCases.controller.handleRenameGroup(patchRequest({ name: "X" }), "pkg-1", "grp-1")).status).toBe(500);
      expect((await withoutUseCases.controller.handleDeleteGroup(deleteRequest(), "pkg-1", "grp-1")).status).toBe(500);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mocks = createManageMocks();
      mocks.renamePackageGroupUseCase.execute.mockRejectedValue(new Error("boom"));
      mocks.deletePackageGroupUseCase.execute.mockRejectedValue(new Error("boom"));

      const renamed = await mocks.controller.handleRenameGroup(patchRequest({ name: "X" }), "pkg-1", "grp-1");
      const deleted = await mocks.controller.handleDeleteGroup(deleteRequest(), "pkg-1", "grp-1");

      expect(renamed.status).toBe(500);
      expect(deleted.status).toBe(500);
      expect((await deleted.json()).error.code).toBe("internal_error");
      consoleSpy.mockRestore();
    });
  });
});
