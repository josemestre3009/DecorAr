import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { AddModuleToPackageUseCase } from "../../modules/packages/application/use-cases/add-module-to-package.use-case";
import { ClonePackageUseCase } from "../../modules/packages/application/use-cases/clone-package.use-case";
import type { CreatePackageUseCase } from "../../modules/packages/application/use-cases/create-package.use-case";
import type { RemoveModuleFromPackageUseCase } from "../../modules/packages/application/use-cases/remove-module-from-package.use-case";
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
  });

  describe("handleAddItem", () => {
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

    it("devuelve 400 si se envía parentGroupId (agrupación fuera de alcance)", async () => {
      const mocks = createMocks();
      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1", parentGroupId: "grupo-1" }),
        method: "POST",
      });

      const res = await mocks.controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("package.grouping_not_supported");
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
  });
});

