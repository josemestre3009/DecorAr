import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { CatalogModuleReader } from "../ports/catalog-module-reader.port";
import type { PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type { PackageGroupReader, PackageGroupRepository } from "../ports/package-group-repository.port";
import type { PackageReader } from "../ports/package-reader.port";
import { AddModuleToGroupUseCase } from "./add-module-to-group.use-case";

function setup(
  capacityM2 = 30,
  commit: Promise<Result<number, DomainError>> = Promise.resolve(ok(5)),
) {
  let counter = 1;
  const idGenerator: IdGenerator = { generate: () => `id-${counter++}` };
  const clock: Clock = { now: () => new Date("2026-10-12T10:00:00.000Z") };
  const packageReader: PackageReader = {
    getItemModuleId: vi.fn(),
    getPackage: vi.fn().mockResolvedValue(
      ok({
        capacityM2,
        clientName: null,
        eventDate: null,
        eventType: null,
        id: "pkg-1",
        items: [{ areaM2: 2, itemId: "item-arco", moduleId: "mod-arco" }],
        name: "Evento",
        spaceType: "casa",
        userId: "user-1",
        venue: null,
        version: 4,
      }),
    ),
  };
  const groupReader: PackageGroupReader = {
    getStructure: vi.fn().mockResolvedValue(
      ok({
        groups: [{ groupId: "zona", name: "Zona de bienvenida", parentGroupId: null }],
        itemGroupIds: { "item-arco": "zona" },
      }),
    ),
  };
  const catalogReader: CatalogModuleReader = {
    getModuleById: vi.fn().mockResolvedValue(ok({ areaM2: 4, id: "mod-mesa", name: "Mesa", priceCop: 250000 })),
  };
  const groupRepository: PackageGroupRepository = {
    addItemToGroup: vi.fn().mockReturnValue(commit),
    createGroup: vi.fn(),
  };
  const consumer: PackageChangeConsumer = { consume: vi.fn().mockResolvedValue(ok(undefined)) };
  const useCase = new AddModuleToGroupUseCase(
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

describe("AddModuleToGroupUseCase", () => {
  it("agrega una hoja al grupo, emite package.module.added y notifica a Presupuesto", async () => {
    const { consumer, groupRepository, useCase } = setup();

    const result = await useCase.execute({
      groupId: "zona",
      moduleId: " mod-mesa ",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result).toEqual(ok({ itemId: "id-1", packageVersion: 5 }));
    expect(groupRepository.addItemToGroup).toHaveBeenCalledWith(
      {
        eventId: "id-2",
        occurredAt: "2026-10-12T10:00:00.000Z",
        packageId: "pkg-1",
        payload: { itemId: "id-1", moduleId: "mod-mesa" },
        schemaVersion: 1,
        type: "package.module.added",
        userId: "user-1",
      },
      "zona",
      4,
      undefined,
    );
    expect(consumer.consume).toHaveBeenCalledTimes(1);
  });

  it("propaga el correlationId al RPC del grupo", async () => {
    const { groupRepository, useCase } = setup();

    await useCase.execute({
      correlationId: "corr-1",
      groupId: "zona",
      moduleId: "mod-mesa",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(vi.mocked(groupRepository.addItemToGroup).mock.calls[0][3]).toBe("corr-1");
  });

  it("rechaza un grupo que no está en el paquete sin llamar al RPC", async () => {
    const { groupRepository, useCase } = setup();

    const result = await useCase.execute({ groupId: "otro", moduleId: "mod-mesa", packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_not_found");
    expect(groupRepository.addItemToGroup).not.toHaveBeenCalled();
  });

  it("guarda la hoja aunque el área exceda la capacidad (DECOR-44)", async () => {
    const { groupRepository, useCase } = setup(5);

    const result = await useCase.execute({ groupId: "zona", moduleId: "mod-mesa", packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(true);
    expect(groupRepository.addItemToGroup).toHaveBeenCalledTimes(1);
  });

  it("propaga el error del RPC y no notifica", async () => {
    const { consumer, useCase } = setup(30, Promise.resolve(err(new DomainError("package.version_conflict", "x"))));

    const result = await useCase.execute({ groupId: "zona", moduleId: "mod-mesa", packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.version_conflict");
    expect(consumer.consume).not.toHaveBeenCalled();
  });
});
