import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { CatalogModuleReader, CatalogModuleSummary } from "../ports/catalog-module-reader.port";
import type { PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type {
  PackageGroupReader,
  PackageGroupRepository,
  PackageStructure,
} from "../ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../ports/package-reader.port";
import { CreatePackageGroupUseCase, MAX_HOJAS_POR_GRUPO } from "./create-package-group.use-case";

const ARCO: CatalogModuleSummary = { areaM2: 2, id: "mod-arco", name: "Arco floral", priceCop: 200000 };
const MESA: CatalogModuleSummary = { areaM2: 4, id: "mod-mesa", name: "Mesa redonda", priceCop: 250000 };
const PISTA: CatalogModuleSummary = { areaM2: 16, id: "mod-pista", name: "Pista de baile", priceCop: 600000 };

function setup(options: {
  detail?: PackageDetail | null;
  structure?: PackageStructure;
  repositoryResult?: ReturnType<PackageGroupRepository["createGroup"]>;
} = {}) {
  let counter = 1;
  const idGenerator: IdGenerator = { generate: () => `id-${counter++}` };
  const clock: Clock = { now: () => new Date("2026-10-12T10:00:00.000Z") };

  const packageReader: PackageReader = {
    getItemModuleId: vi.fn(),
    getPackage: vi.fn().mockResolvedValue(
      ok(
        options.detail === undefined
          ? { capacityM2: 30, id: "pkg-1", items: [], spaceType: "casa", userId: "user-1", version: 4 }
          : options.detail,
      ),
    ),
  };
  const groupReader: PackageGroupReader = {
    getStructure: vi.fn().mockResolvedValue(ok(options.structure ?? { groups: [], itemGroupIds: {} })),
  };
  const catalogReader: CatalogModuleReader = {
    getModuleById: vi.fn(async (moduleId: string) =>
      ok([ARCO, MESA, PISTA].find((m) => m.id === moduleId) ?? null),
    ),
  };
  const groupRepository: PackageGroupRepository = {
    addItemToGroup: vi.fn(),
    createGroup: vi.fn(
      async (command: Parameters<PackageGroupRepository["createGroup"]>[0]) =>
        options.repositoryResult ??
        ok({
          depth: command.parentGroupId ? 2 : 1,
          groupId: command.groupId,
          itemIds: command.events.map((e) => e.payload.itemId),
          packageVersion: 4 + command.events.length,
        }),
    ),
  };
  const consumer: PackageChangeConsumer = { consume: vi.fn().mockResolvedValue(ok(undefined)) };

  const useCase = new CreatePackageGroupUseCase(
    packageReader,
    groupReader,
    catalogReader,
    groupRepository,
    clock,
    idGenerator,
    consumer,
  );

  return { consumer, groupRepository, useCase };
}

describe("CreatePackageGroupUseCase", () => {
  it("crea la Zona de bienvenida (arco + mesa) con un evento add por hoja y notifica a Presupuesto", async () => {
    const { consumer, groupRepository, useCase } = setup();

    const result = await useCase.execute({
      moduleIds: [ARCO.id, MESA.id],
      name: " Zona de bienvenida ",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result).toEqual(
      ok({
        depth: 1,
        groupId: "id-1",
        itemIds: ["id-2", "id-3"],
        name: "Zona de bienvenida",
        packageVersion: 6,
        parentGroupId: null,
      }),
    );

    expect(groupRepository.createGroup).toHaveBeenCalledWith({
      correlationId: null,
      events: [
        {
          eventId: "id-4",
          occurredAt: "2026-10-12T10:00:00.000Z",
          packageId: "pkg-1",
          payload: { itemId: "id-2", moduleId: ARCO.id },
          schemaVersion: 1,
          type: "package.module.added",
          userId: "user-1",
        },
        {
          eventId: "id-5",
          occurredAt: "2026-10-12T10:00:00.000Z",
          packageId: "pkg-1",
          payload: { itemId: "id-3", moduleId: MESA.id },
          schemaVersion: 1,
          type: "package.module.added",
          userId: "user-1",
        },
      ],
      expectedVersion: 4,
      groupId: "id-1",
      name: "Zona de bienvenida",
      packageId: "pkg-1",
      parentGroupId: null,
      userId: "user-1",
    });
    // Un solo recálculo por petición, con el último evento (versión final).
    expect(consumer.consume).toHaveBeenCalledTimes(1);
    expect(consumer.consume).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "id-5", payload: { itemId: "id-3", moduleId: MESA.id } }),
    );
  });

  it("propaga el correlationId al comando del RPC", async () => {
    const { groupRepository, useCase } = setup();

    await useCase.execute({
      correlationId: "corr-1",
      moduleIds: [ARCO.id],
      name: "Zona",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(vi.mocked(groupRepository.createGroup).mock.calls[0][0].correlationId).toBe("corr-1");
  });

  it("un grupo sin hojas no emite eventos ni recalcula", async () => {
    const { consumer, groupRepository, useCase } = setup();

    const result = await useCase.execute({ name: "Vacío", packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(true);
    expect(vi.mocked(groupRepository.createGroup).mock.calls[0][0].events).toEqual([]);
    expect(consumer.consume).not.toHaveBeenCalled();
  });

  it("crea un subgrupo dentro de un grupo existente", async () => {
    const { groupRepository, useCase } = setup({
      structure: { groups: [{ groupId: "zona", name: "Zona", parentGroupId: null }], itemGroupIds: {} },
    });

    const result = await useCase.execute({
      name: "Sub",
      packageId: "pkg-1",
      parentGroupId: "zona",
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    expect(vi.mocked(groupRepository.createGroup).mock.calls[0][0].parentGroupId).toBe("zona");
  });

  it("rechaza un cuarto nivel en el dominio sin llamar al RPC", async () => {
    const { groupRepository, useCase } = setup({
      structure: {
        groups: [
          { groupId: "g1", name: "1", parentGroupId: null },
          { groupId: "g2", name: "2", parentGroupId: "g1" },
          { groupId: "g3", name: "3", parentGroupId: "g2" },
        ],
        itemGroupIds: {},
      },
    });

    const result = await useCase.execute({ name: "4", packageId: "pkg-1", parentGroupId: "g3", userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_depth_exceeded");
    expect(groupRepository.createGroup).not.toHaveBeenCalled();
  });

  it("rechaza por capacidad contando las hojas que ya están dentro de grupos", async () => {
    const { groupRepository, useCase } = setup({
      detail: {
        capacityM2: 20,
        id: "pkg-1",
        items: [{ areaM2: 16, itemId: "item-pista", moduleId: PISTA.id }],
        spaceType: "casa",
        userId: "user-1",
        version: 2,
      },
      structure: {
        groups: [{ groupId: "zona", name: "Zona", parentGroupId: null }],
        itemGroupIds: { "item-pista": "zona" },
      },
    });

    const result = await useCase.execute({
      moduleIds: [ARCO.id, MESA.id],
      name: "Zona de bienvenida",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.capacity_exceeded");
    expect(groupRepository.createGroup).not.toHaveBeenCalled();
  });

  it("rechaza grupo padre inexistente, módulo inexistente y nombre inválido antes del RPC", async () => {
    const cases = [
      { code: "package.group_not_found", dto: { name: "X", parentGroupId: "no-existe" } },
      { code: "package.invalid_group", dto: { name: "X", parentGroupId: "   " } },
      { code: "package.module_not_found", dto: { moduleIds: ["no-existe"], name: "X" } },
      { code: "package.invalid_group_name", dto: { name: "  " } },
      { code: "package.invalid_module", dto: { moduleIds: [" "], name: "X" } },
      {
        code: "package.too_many_children",
        dto: { moduleIds: Array.from({ length: MAX_HOJAS_POR_GRUPO + 1 }, () => MESA.id), name: "X" },
      },
    ];

    for (const { code, dto } of cases) {
      const { groupRepository, useCase } = setup();
      const result = await useCase.execute({ packageId: "pkg-1", userId: "user-1", ...dto });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(code);
      expect(groupRepository.createGroup).not.toHaveBeenCalled();
    }
  });

  it("paquete ajeno o inexistente: package.not_found", async () => {
    const { groupRepository, useCase } = setup({ detail: null });

    const result = await useCase.execute({ name: "X", packageId: "pkg-1", userId: "user-2" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.not_found");
    expect(groupRepository.createGroup).not.toHaveBeenCalled();
  });

  it("si el RPC falla no notifica a Presupuesto", async () => {
    const { consumer, useCase } = setup({
      repositoryResult: Promise.resolve(err(new DomainError("package.module_not_found", "x"))),
    });

    const result = await useCase.execute({ moduleIds: [ARCO.id], name: "X", packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(false);
    expect(consumer.consume).not.toHaveBeenCalled();
  });
});
