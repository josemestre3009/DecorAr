import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { PackageGroupReader, PackageStructure, PackageStructureEditorRepository } from "../ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../ports/package-reader.port";
import { UpdatePackageGroupUseCase } from "./update-package-group.use-case";

const DETAIL: PackageDetail = {
  capacityM2: 30,
  clientName: null,
  eventDate: null,
  eventType: null,
  id: "pkg-1",
  items: [{ areaM2: 2, itemId: "item-1", moduleId: "mod-arco" }],
  name: "Evento",
  spaceType: "casa",
  userId: "user-1",
  venue: null,
  version: 4,
};

function setup(options: { detail?: PackageDetail | null; structure?: PackageStructure } = {}) {
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
            { groupId: "otro", name: "Otra", parentGroupId: null },
          ],
          itemGroupIds: { "item-1": "zona" },
        },
      ),
    ),
  };
  const editor: PackageStructureEditorRepository = {
    deleteGroup: vi.fn(),
    moveItem: vi.fn(),
    updateGroup: vi.fn().mockResolvedValue(ok(5)),
  };
  const useCase = new UpdatePackageGroupUseCase(packageReader, groupReader, editor);

  return { editor, useCase };
}

describe("UpdatePackageGroupUseCase", () => {
  it("rechaza la versión esperada obsoleta antes de persistir", async () => {
    const { editor, useCase } = setup();
    const result = await useCase.execute({
      expectedVersion: 2,
      groupId: "zona",
      name: "Recepción",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.version_conflict");
    expect(editor.updateGroup).not.toHaveBeenCalled();
  });
  it("renombra una zona con trim y envía la versión observada sin mover", async () => {
    const { editor, useCase } = setup();

    const result = await useCase.execute({ groupId: "zona", name: "  Recepción  ", packageId: "pkg-1", userId: "user-1" });

    expect(editor.updateGroup).toHaveBeenCalledWith({
      correlationId: null,
      expectedVersion: 4,
      groupId: "zona",
      name: "Recepción",
      packageId: "pkg-1",
      parentGroupId: undefined,
      userId: "user-1",
    });
    expect(result).toEqual(ok({ groupId: "zona", name: "Recepción", packageVersion: 5, parentGroupId: null }));
  });

  it("mueve una subzona a otra zona conservando su id", async () => {
    const { editor, useCase } = setup();

    const result = await useCase.execute({ groupId: "sub", packageId: "pkg-1", parentGroupId: "otro", userId: "user-1" });

    expect(editor.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "sub", parentGroupId: "otro", name: undefined }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.parentGroupId).toBe("otro");
  });

  it("mueve una zona a la raíz con parentGroupId null", async () => {
    const { editor, useCase } = setup();

    const result = await useCase.execute({ groupId: "sub", packageId: "pkg-1", parentGroupId: null, userId: "user-1" });

    expect(vi.mocked(editor.updateGroup).mock.calls[0][0].parentGroupId).toBeNull();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.parentGroupId).toBeNull();
  });

  it("propaga el correlationId", async () => {
    const { editor, useCase } = setup();

    await useCase.execute({ correlationId: "corr-1", groupId: "zona", name: "X", packageId: "pkg-1", userId: "user-1" });

    expect(vi.mocked(editor.updateGroup).mock.calls[0][0].correlationId).toBe("corr-1");
  });

  it("rechaza un ciclo y no llama a la RPC", async () => {
    const { editor, useCase } = setup();

    const result = await useCase.execute({ groupId: "zona", packageId: "pkg-1", parentGroupId: "sub", userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_cycle");
    expect(editor.updateGroup).not.toHaveBeenCalled();
  });

  it("rechaza un movimiento que supere tres niveles", async () => {
    const { editor, useCase } = setup({
      structure: {
        groups: [
          { groupId: "a", name: "A", parentGroupId: null },
          { groupId: "b", name: "B", parentGroupId: "a" },
          { groupId: "c", name: "C", parentGroupId: "b" },
          { groupId: "destino", name: "Destino", parentGroupId: null },
        ],
        itemGroupIds: {},
      },
    });

    const result = await useCase.execute({ groupId: "a", packageId: "pkg-1", parentGroupId: "destino", userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_depth_exceeded");
    expect(editor.updateGroup).not.toHaveBeenCalled();
  });

  it("exige al menos un cambio y un nombre válido", async () => {
    const sinCambio = await setup().useCase.execute({ groupId: "zona", packageId: "pkg-1", userId: "user-1" });
    expect(sinCambio.ok).toBe(false);
    if (!sinCambio.ok) expect(sinCambio.error.code).toBe("package.invalid");

    const { editor, useCase } = setup();
    const nombreInvalido = await useCase.execute({ groupId: "zona", name: "   ", packageId: "pkg-1", userId: "user-1" });
    expect(nombreInvalido.ok).toBe(false);
    if (!nombreInvalido.ok) expect(nombreInvalido.error.code).toBe("package.invalid_group_name");
    expect(editor.updateGroup).not.toHaveBeenCalled();
  });

  it("trata una zona ajena o inexistente como 404 y un paquete ajeno como not_found", async () => {
    const { editor, useCase } = setup();
    const zonaAjena = await useCase.execute({ groupId: "no-existe", name: "X", packageId: "pkg-1", userId: "user-1" });
    expect(zonaAjena.ok).toBe(false);
    if (!zonaAjena.ok) expect(zonaAjena.error.code).toBe("package.group_not_found");

    const ajeno = await setup({ detail: null }).useCase.execute({ groupId: "zona", name: "X", packageId: "pkg-1", userId: "user-2" });
    expect(ajeno.ok).toBe(false);
    if (!ajeno.ok) expect(ajeno.error.code).toBe("package.not_found");
    expect(editor.updateGroup).not.toHaveBeenCalled();
  });

  it("propaga el fallo de la RPC", async () => {
    const failure = new DomainError("package.version_conflict", "x");
    const { editor, useCase } = setup();
    vi.mocked(editor.updateGroup).mockResolvedValue(err(failure));

    const result = await useCase.execute({ groupId: "zona", name: "X", packageId: "pkg-1", userId: "user-1" });

    expect(result).toEqual(err(failure));
  });
});
