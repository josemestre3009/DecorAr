import { describe, expect, it, vi } from "vitest";
import { ok } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageChangeOutbox } from "../../../events/application/outbox";
import type { CatalogModuleReader } from "../ports/catalog-module-reader.port";
import type { PackageReader } from "../ports/package-reader.port";
import { AddModuleToPackageUseCase } from "./add-module-to-package.use-case";

describe("AddModuleToPackageUseCase", () => {
  const fixedDate = new Date("2026-10-08T12:00:00.000Z");
  const mockClock: Clock = { now: () => fixedDate };
  let idCounter = 1;
  const mockIdGenerator: IdGenerator = {
    generate: () => `id-${idCounter++}`,
  };

  it("agrega un módulo y comete el evento atómicamente si está dentro de la capacidad", async () => {
    idCounter = 1;
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(
        ok({
          capacityM2: 30,
          id: "pkg-1",
          items: [{ areaM2: 10, itemId: "item-prev", moduleId: "mod-prev" }],
          spaceType: "casa",
          userId: "user-1",
          version: 2,
        }),
      ),
    };

    const mockCatalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(
        ok({
          areaM2: 16,
          id: "mod-1",
          name: "Pista de baile",
          priceCop: 600000,
        }),
      ),
    };

    const mockOutbox: PackageChangeOutbox = {
      commit: vi.fn().mockResolvedValue(ok(3)),
    };

    const useCase = new AddModuleToPackageUseCase(
      mockPackageReader,
      mockCatalogReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
    );

    const result = await useCase.execute({
      moduleId: "mod-1",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.itemId).toBe("id-1");
      expect(result.value.packageVersion).toBe(3);
    }

    expect(mockOutbox.commit).toHaveBeenCalledTimes(1);
    expect(mockOutbox.commit).toHaveBeenCalledWith(
      {
        eventId: "id-2",
        occurredAt: "2026-10-08T12:00:00.000Z",
        packageId: "pkg-1",
        payload: {
          itemId: "id-1",
          moduleId: "mod-1",
        },
        schemaVersion: 1,
        type: "package.module.added",
        userId: "user-1",
      },
      2,
    );
  });

  it("rechaza y deja cero escritura/evento cuando excede la capacidad", async () => {
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(
        ok({
          capacityM2: 30,
          id: "pkg-1",
          items: [{ areaM2: 16, itemId: "item-prev", moduleId: "mod-prev" }],
          spaceType: "casa",
          userId: "user-1",
          version: 2,
        }),
      ),
    };

    const mockCatalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(
        ok({
          areaM2: 16, // 16 + 16 = 32 > 30!
          id: "mod-pista-2",
          name: "Pista de baile 4x4",
          priceCop: 600000,
        }),
      ),
    };

    const mockOutbox: PackageChangeOutbox = {
      commit: vi.fn(),
    };

    const useCase = new AddModuleToPackageUseCase(
      mockPackageReader,
      mockCatalogReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
    );

    const result = await useCase.execute({
      moduleId: "mod-pista-2",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.capacity_exceeded");
      expect(result.error.message).toContain("excede la capacidad del espacio (32/30 m²)");
    }

    // Cero escritura / evento: outbox.commit jamás debe llamarse
    expect(mockOutbox.commit).not.toHaveBeenCalled();
  });

  it("rechaza si el paquete no existe o no pertenece al usuario", async () => {
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(ok(null)),
    };
    const mockCatalogReader: CatalogModuleReader = { getModuleById: vi.fn() };
    const mockOutbox: PackageChangeOutbox = { commit: vi.fn() };

    const useCase = new AddModuleToPackageUseCase(
      mockPackageReader,
      mockCatalogReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
    );

    const result = await useCase.execute({
      moduleId: "mod-1",
      packageId: "pkg-inexistente",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.not_found");
    }
    expect(mockOutbox.commit).not.toHaveBeenCalled();
  });

  it("rechaza si el módulo no existe en el catálogo", async () => {
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(
        ok({
          capacityM2: 50,
          id: "pkg-1",
          items: [],
          spaceType: "casa",
          userId: "user-1",
          version: 1,
        }),
      ),
    };
    const mockCatalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(ok(null)),
    };
    const mockOutbox: PackageChangeOutbox = { commit: vi.fn() };

    const useCase = new AddModuleToPackageUseCase(
      mockPackageReader,
      mockCatalogReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
    );

    const result = await useCase.execute({
      moduleId: "mod-fantasma",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.module_not_found");
    }
    expect(mockOutbox.commit).not.toHaveBeenCalled();
  });
});
