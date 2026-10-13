import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type { PackageGroupReader, PackageStructure, PackageStructureEditorRepository } from "../ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../ports/package-reader.port";
import { DeletePackageGroupUseCase } from "./delete-package-group.use-case";

const DETAIL: PackageDetail = {
  capacityM2: 100,
  clientName: null,
  eventDate: null,
  eventType: null,
  id: "pkg-1",
  items: [
    { areaM2: 2, itemId: "item-1", moduleId: "mod-arco" },
    { areaM2: 4, itemId: "item-2", moduleId: "mod-mesa" },
    { areaM2: 16, itemId: "item-3", moduleId: "mod-pista" },
  ],
  name: "Evento",
  spaceType: "casa",
  userId: "user-1",
  venue: null,
  version: 4,
};

function setup(options: { detail?: PackageDetail | null; structure?: PackageStructure } = {}) {
  let counter = 1;
  const idGenerator: IdGenerator = { generate: () => `event-${counter++}` };
  const clock: Clock = { now: () => new Date("2026-10-12T10:00:00.000Z") };
  const packageReader: PackageReader = {
    getItemModuleId: vi.fn(),
    getPackage: vi.fn().mockResolvedValue(ok(options.detail === undefined ? DETAIL : options.detail)),
  };
  const groupReader: PackageGroupReader = {
    getStructure: vi.fn().mockResolvedValue(
      ok(
        options.structure ?? {
          groups: [
            { groupId: "zona", name: "Zona", parentGroupId: null },
            { groupId: "sub", name: "Sub", parentGroupId: "zona" },
          ],
          itemGroupIds: { "item-1": "zona", "item-2": "sub" },
        },
      ),
    ),
  };
  const editor: PackageStructureEditorRepository = {
    deleteGroup: vi.fn().mockResolvedValue(ok(5)),
    moveItem: vi.fn(),
    updateGroup: vi.fn(),
  };
  const consumer: PackageChangeConsumer = { consume: vi.fn().mockResolvedValue(ok(undefined)) };
  const useCase = new DeletePackageGroupUseCase(packageReader, groupReader, editor, clock, idGenerator, consumer);

  return { consumer, editor, useCase };
}

describe("DeletePackageGroupUseCase", () => {
  it("move_to_root emite moved por cada hoja directa y deja intacto el subárbol", async () => {
    const { consumer, editor, useCase } = setup();

    const result = await useCase.execute({ groupId: "zona", packageId: "pkg-1", strategy: "move_to_root", userId: "user-1" });

    expect(result).toEqual(ok({ groupId: "zona", packageVersion: 5, strategy: "move_to_root" }));
    expect(editor.deleteGroup).toHaveBeenCalledWith({
      correlationId: null,
      events: [
        {
          eventId: "event-1",
          occurredAt: "2026-10-12T10:00:00.000Z",
          packageId: "pkg-1",
          payload: { fromGroupId: "zona", itemId: "item-1", moduleId: "mod-arco", toGroupId: null },
          schemaVersion: 1,
          type: "package.module.moved",
          userId: "user-1",
        },
      ],
      expectedVersion: 4,
      groupId: "zona",
      packageId: "pkg-1",
      strategy: "move_to_root",
      userId: "user-1",
    });
    expect(consumer.consume).toHaveBeenCalledTimes(1);
  });

  it("delete_contents emite removed por todo el subárbol y notifica una sola vez", async () => {
    const { consumer, editor, useCase } = setup();

    await useCase.execute({ groupId: "zona", packageId: "pkg-1", strategy: "delete_contents", userId: "user-1" });

    const command = vi.mocked(editor.deleteGroup).mock.calls[0][0];
    expect(command.events.map((e) => e.type)).toEqual(["package.module.removed", "package.module.removed"]);
    expect(command.events.map((e) => e.payload.itemId).sort()).toEqual(["item-1", "item-2"]);
    expect(command.events.every((e) => (e.payload as { itemId: string; moduleId: string }).moduleId.length > 0)).toBe(true);
    expect(consumer.consume).toHaveBeenCalledTimes(1);
  });

  it("una zona sin contenido no emite eventos pero versiona", async () => {
    const { consumer, editor, useCase } = setup({ structure: { groups: [{ groupId: "zona", name: "Zona", parentGroupId: null }], itemGroupIds: {} } });

    const result = await useCase.execute({ groupId: "zona", packageId: "pkg-1", strategy: "delete_contents", userId: "user-1" });

    expect(result.ok).toBe(true);
    expect(vi.mocked(editor.deleteGroup).mock.calls[0][0].events).toEqual([]);
    expect(consumer.consume).not.toHaveBeenCalled();
  });

  it("rechaza una estrategia ausente o inválida sin escribir", async () => {
    const { editor, useCase } = setup();

    const result = await useCase.execute({ groupId: "zona", packageId: "pkg-1", strategy: "explode" as never, userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.invalid");
    expect(editor.deleteGroup).not.toHaveBeenCalled();
  });

  it("trata la zona ajena como 404 y el paquete ajeno como not_found", async () => {
    const { editor, useCase } = setup();
    const zonaAjena = await useCase.execute({ groupId: "no-existe", packageId: "pkg-1", strategy: "delete_contents", userId: "user-1" });
    expect(zonaAjena.ok).toBe(false);
    if (!zonaAjena.ok) expect(zonaAjena.error.code).toBe("package.group_not_found");

    const ajeno = await setup({ detail: null }).useCase.execute({ groupId: "zona", packageId: "pkg-1", strategy: "delete_contents", userId: "user-2" });
    expect(ajeno.ok).toBe(false);
    if (!ajeno.ok) expect(ajeno.error.code).toBe("package.not_found");
    expect(editor.deleteGroup).not.toHaveBeenCalled();
  });

  it("propaga el fallo de la RPC sin notificar", async () => {
    const failure = new DomainError("package.version_conflict", "x");
    const { consumer, editor, useCase } = setup();
    vi.mocked(editor.deleteGroup).mockResolvedValue(err(failure));

    const result = await useCase.execute({ groupId: "zona", packageId: "pkg-1", strategy: "delete_contents", userId: "user-1" });

    expect(result).toEqual(err(failure));
    expect(consumer.consume).not.toHaveBeenCalled();
  });
});
