import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type { PackageGroupReader, PackageStructure, PackageStructureEditorRepository } from "../ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../ports/package-reader.port";
import { MovePackageItemUseCase } from "./move-package-item.use-case";

const DETAIL: PackageDetail = {
  capacityM2: 100,
  clientName: null,
  eventDate: null,
  eventType: null,
  id: "pkg-1",
  items: [
    { areaM2: 2, itemId: "item-1", moduleId: "mod-arco" },
    { areaM2: 4, itemId: "item-3", moduleId: "mod-mesa" },
  ],
  name: "Evento",
  spaceType: "casa",
  userId: "user-1",
  venue: null,
  version: 4,
};

function setup(options: { detail?: PackageDetail | null; structure?: PackageStructure } = {}) {
  const idGenerator: IdGenerator = { generate: () => "event-1" };
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
            { groupId: "otra", name: "Otra", parentGroupId: null },
          ],
          itemGroupIds: { "item-1": "zona" },
        },
      ),
    ),
  };
  const editor: PackageStructureEditorRepository = {
    deleteGroup: vi.fn(),
    moveItem: vi.fn().mockResolvedValue(ok(5)),
    updateGroup: vi.fn(),
  };
  const consumer: PackageChangeConsumer = { consume: vi.fn().mockResolvedValue(ok(undefined)) };
  const useCase = new MovePackageItemUseCase(packageReader, groupReader, editor, clock, idGenerator, consumer);

  return { consumer, editor, useCase };
}

describe("MovePackageItemUseCase", () => {
  it("mueve una instancia entre zonas conservando itemId y moduleId", async () => {
    const { consumer, editor, useCase } = setup();

    const result = await useCase.execute({ groupId: "otra", itemId: "item-1", packageId: "pkg-1", userId: "user-1" });

    expect(result).toEqual(ok({ groupId: "otra", itemId: "item-1", packageVersion: 5 }));
    expect(editor.moveItem).toHaveBeenCalledWith({
      correlationId: null,
      event: {
        eventId: "event-1",
        occurredAt: "2026-10-12T10:00:00.000Z",
        packageId: "pkg-1",
        payload: { fromGroupId: "zona", itemId: "item-1", moduleId: "mod-arco", toGroupId: "otra" },
        schemaVersion: 1,
        type: "package.module.moved",
        userId: "user-1",
      },
      expectedVersion: 4,
      groupId: "otra",
      itemId: "item-1",
      packageId: "pkg-1",
      userId: "user-1",
    });
    expect(consumer.consume).toHaveBeenCalledTimes(1);
  });

  it("mueve de la raíz a una zona con fromGroupId null", async () => {
    const { editor, useCase } = setup();

    await useCase.execute({ groupId: "zona", itemId: "item-3", packageId: "pkg-1", userId: "user-1" });

    const command = vi.mocked(editor.moveItem).mock.calls[0][0];
    expect(command.event.payload.fromGroupId).toBeNull();
    expect(command.event.payload.toGroupId).toBe("zona");
  });

  it("mueve de una zona a la raíz con toGroupId null", async () => {
    const { editor, useCase } = setup();

    await useCase.execute({ groupId: null, itemId: "item-1", packageId: "pkg-1", userId: "user-1" });

    const command = vi.mocked(editor.moveItem).mock.calls[0][0];
    expect(command.event.payload.fromGroupId).toBe("zona");
    expect(command.event.payload.toGroupId).toBeNull();
  });

  it("mover a la misma ubicación es un no-op sin escribir ni notificar", async () => {
    const { consumer, editor, useCase } = setup();

    const result = await useCase.execute({ groupId: "zona", itemId: "item-1", packageId: "pkg-1", userId: "user-1" });

    expect(result).toEqual(ok({ groupId: "zona", itemId: "item-1", packageVersion: 4 }));
    expect(editor.moveItem).not.toHaveBeenCalled();
    expect(consumer.consume).not.toHaveBeenCalled();
  });

  it("trata un destino o un item ajeno como 404 sin escribir", async () => {
    const { editor, useCase } = setup();
    const destinoAjeno = await useCase.execute({ groupId: "no-existe", itemId: "item-1", packageId: "pkg-1", userId: "user-1" });
    expect(destinoAjeno.ok).toBe(false);
    if (!destinoAjeno.ok) expect(destinoAjeno.error.code).toBe("package.group_not_found");

    const itemAjeno = await useCase.execute({ groupId: "otra", itemId: "no-existe", packageId: "pkg-1", userId: "user-1" });
    expect(itemAjeno.ok).toBe(false);
    if (!itemAjeno.ok) expect(itemAjeno.error.code).toBe("package.item_not_found");

    expect(editor.moveItem).not.toHaveBeenCalled();
  });

  it("propaga el fallo de la RPC sin notificar", async () => {
    const failure = new DomainError("package.version_conflict", "x");
    const { consumer, editor, useCase } = setup();
    vi.mocked(editor.moveItem).mockResolvedValue(err(failure));

    const result = await useCase.execute({ groupId: "otra", itemId: "item-1", packageId: "pkg-1", userId: "user-1" });

    expect(result).toEqual(err(failure));
    expect(consumer.consume).not.toHaveBeenCalled();
  });
});
