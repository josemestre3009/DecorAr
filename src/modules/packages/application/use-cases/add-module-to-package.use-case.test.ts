import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../../../../shared/domain/result";
import { DomainError } from "../../../../shared/domain/domain-error";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageChangeOutbox } from "../../../events/application/outbox";
import type { CatalogModuleReader } from "../ports/catalog-module-reader.port";
import type { PackageDetail, PackageReader } from "../ports/package-reader.port";
import { AddModuleToPackageUseCase } from "./add-module-to-package.use-case";

function detail(overrides: Partial<PackageDetail> = {}): PackageDetail {
  return {
    capacityM2: 30,
    clientName: null,
    eventDate: null,
    eventType: null,
    id: "pkg-1",
    items: [],
    name: "Evento",
    spaceType: "casa",
    userId: "user-1",
    venue: null,
    version: 1,
    ...overrides,
  };
}

describe("AddModuleToPackageUseCase", () => {
  const fixedDate = new Date("2026-10-08T12:00:00.000Z");
  const mockClock: Clock = { now: () => fixedDate };
  let idCounter = 1;
  const mockIdGenerator: IdGenerator = {
    generate: () => `id-${idCounter++}`,
  };

  it("agrega un módulo y comete el evento atómicamente", async () => {
    idCounter = 1;
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(
        ok(detail({ capacityM2: 30, items: [{ areaM2: 10, itemId: "item-prev", moduleId: "mod-prev" }], version: 2 })),
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

  it("valida y confirma varias unidades en un único lote", async () => {
    idCounter = 1;
    const packageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(ok(detail({ capacityM2: 30, items: [], version: 4 }))),
    };
    const catalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(ok({
        areaM2: 2,
        id: "mod-1",
        name: "Silla",
        priceCop: 100000,
      })),
    };
    const commitBatch = vi.fn().mockResolvedValue(ok(7));
    const outbox: PackageChangeOutbox = { commit: vi.fn(), commitBatch };
    const consume = vi.fn().mockResolvedValue(ok(undefined));
    const useCase = new AddModuleToPackageUseCase(
      packageReader,
      catalogReader,
      outbox,
      mockClock,
      mockIdGenerator,
      { consume },
    );

    const result = await useCase.execute({
      correlationId: "corr-batch",
      moduleId: "mod-1",
      packageId: "pkg-1",
      quantity: 3,
      userId: "user-1",
    });

    expect(result).toEqual(ok({ itemId: "id-1", itemIds: ["id-1", "id-3", "id-5"], packageVersion: 7 }));
    expect(commitBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ payload: { itemId: "id-1", moduleId: "mod-1" } }),
        expect.objectContaining({ payload: { itemId: "id-5", moduleId: "mod-1" } }),
      ]),
      4,
      "corr-batch",
    );
    expect(outbox.commit).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith(expect.objectContaining({ payload: { itemId: "id-5", moduleId: "mod-1" } }));
  });

  it("rechaza una cantidad no entera o no positiva antes de leer o escribir", async () => {
    const packageReader: PackageReader = { getItemModuleId: vi.fn(), getPackage: vi.fn() };
    const catalogReader: CatalogModuleReader = { getModuleById: vi.fn() };
    const outbox: PackageChangeOutbox = { commit: vi.fn(), commitBatch: vi.fn() };
    const useCase = new AddModuleToPackageUseCase(
      packageReader,
      catalogReader,
      outbox,
      mockClock,
      mockIdGenerator,
    );

    for (const quantity of [0, -1, 1.5, 101]) {
      const result = await useCase.execute({ moduleId: "mod-1", packageId: "pkg-1", quantity, userId: "user-1" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.invalid_quantity");
    }
    expect(packageReader.getPackage).not.toHaveBeenCalled();
    expect(outbox.commit).not.toHaveBeenCalled();
  });

  it("guarda el lote aunque el área requerida supere la disponible (DECOR-44)", async () => {
    const packageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(ok(detail({ capacityM2: 5, items: [], version: 1 }))),
    };
    const catalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(ok({ areaM2: 2, id: "mod-1", name: "Silla", priceCop: 1 })),
    };
    const commitBatch = vi.fn().mockResolvedValue(ok(3));
    const outbox: PackageChangeOutbox = { commit: vi.fn(), commitBatch };
    const useCase = new AddModuleToPackageUseCase(
      packageReader,
      catalogReader,
      outbox,
      mockClock,
      mockIdGenerator,
    );

    // 3 × 2 m² = 6 m² > 5 m²: no bloquea, se confirma el lote.
    const result = await useCase.execute({ moduleId: "mod-1", packageId: "pkg-1", quantity: 3, userId: "user-1" });

    expect(result.ok).toBe(true);
    expect(commitBatch).toHaveBeenCalledTimes(1);
  });

  it("pasa correlationId al outbox cuando se recibe en el dto (DECOR-31)", async () => {
    idCounter = 1;
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(ok(detail({ capacityM2: 30, items: [], version: 1 }))),
    };
    const mockCatalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(
        ok({ areaM2: 16, id: "mod-1", name: "Pista de baile", priceCop: 600000 }),
      ),
    };
    const mockOutbox: PackageChangeOutbox = { commit: vi.fn().mockResolvedValue(ok(2)) };

    const useCase = new AddModuleToPackageUseCase(
      mockPackageReader,
      mockCatalogReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
    );

    await useCase.execute({
      correlationId: "corr-abc",
      moduleId: "mod-1",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(mockOutbox.commit).toHaveBeenCalledWith(expect.anything(), 1, "corr-abc");
  });

  it("notifica al consumidor de presupuesto con el mismo evento tras el commit", async () => {
    idCounter = 1;
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(ok(detail({ capacityM2: 30, items: [], version: 1 }))),
    };
    const mockCatalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(
        ok({ areaM2: 16, id: "mod-1", name: "Pista de baile", priceCop: 600000 }),
      ),
    };
    const mockOutbox: PackageChangeOutbox = { commit: vi.fn().mockResolvedValue(ok(2)) };
    const consume = vi.fn().mockResolvedValue(ok(undefined));

    const useCase = new AddModuleToPackageUseCase(
      mockPackageReader,
      mockCatalogReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
      { consume },
    );

    const result = await useCase.execute({
      moduleId: "mod-1",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0][0]).toMatchObject({
      payload: { itemId: "id-1", moduleId: "mod-1" },
      type: "package.module.added",
    });
  });

  it("no notifica al consumidor si el commit falla", async () => {
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(ok(detail({ capacityM2: 50, items: [], version: 1 }))),
    };
    const mockCatalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(
        ok({ areaM2: 16, id: "mod-1", name: "Pista", priceCop: 600000 }),
      ),
    };
    const mockOutbox: PackageChangeOutbox = {
      commit: vi.fn().mockResolvedValue(err(new DomainError("package.version_conflict", "conflicto"))),
    };
    const consume = vi.fn();

    const useCase = new AddModuleToPackageUseCase(
      mockPackageReader,
      mockCatalogReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
      { consume },
    );

    const result = await useCase.execute({
      moduleId: "mod-1",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    expect(consume).not.toHaveBeenCalled();
  });

  it("guarda aunque el área resultante exceda la capacidad (DECOR-44)", async () => {
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn(),
      getPackage: vi.fn().mockResolvedValue(
        ok(detail({ capacityM2: 30, items: [{ areaM2: 16, itemId: "item-prev", moduleId: "mod-prev" }], version: 2 })),
      ),
    };

    const mockCatalogReader: CatalogModuleReader = {
      getModuleById: vi.fn().mockResolvedValue(
        ok({
          areaM2: 16, // 16 + 16 = 32 > 30, ya no bloquea.
          id: "mod-pista-2",
          name: "Pista de baile 4x4",
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
      moduleId: "mod-pista-2",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    expect(mockOutbox.commit).toHaveBeenCalledTimes(1);
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
      getPackage: vi.fn().mockResolvedValue(ok(detail({ capacityM2: 50, items: [], version: 1 }))),
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
