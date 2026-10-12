import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type {
  PackageGroupReader,
  PackageGroupRepository,
  PackageStructure,
} from "../ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../ports/package-reader.port";
import { DeletePackageGroupUseCase } from "./delete-package-group.use-case";

const DETAIL: PackageDetail = {
  capacityM2: 30,
  id: "pkg-1",
  items: [
    { areaM2: 4, itemId: "item-1", moduleId: "mod-mesa" },
    { areaM2: 2, itemId: "item-2", moduleId: "mod-arco" },
  ],
  spaceType: "casa",
  userId: "user-1",
  version: 9,
};

/** sala > mesa > centro, con una hoja en sala y otra en centro. */
const STRUCTURE: PackageStructure = {
  groups: [
    { groupId: "sala", name: "Sala", parentGroupId: null },
    { groupId: "mesa", name: "Mesa", parentGroupId: "sala" },
    { groupId: "centro", name: "Centro", parentGroupId: "mesa" },
  ],
  itemGroupIds: { "item-1": "sala", "item-2": "centro" },
};

function setup(
  options: {
    detail?: PackageDetail | null;
    deleteResult?: ReturnType<PackageGroupRepository["deleteGroup"]>;
  } = {},
) {
  const packageReader: PackageReader = {
    getItemModuleId: vi.fn(),
    getPackage: vi.fn().mockResolvedValue(ok(options.detail === undefined ? DETAIL : options.detail)),
  };
  const groupReader: PackageGroupReader = { getStructure: vi.fn().mockResolvedValue(ok(STRUCTURE)) };
  const groupRepository: PackageGroupRepository = {
    addItemToGroup: vi.fn(),
    createGroup: vi.fn(),
    deleteGroup: vi.fn(
      async (command: Parameters<PackageGroupRepository["deleteGroup"]>[0]) =>
        options.deleteResult ??
        ok({
          groupId: command.groupId,
          parentGroupId: null,
          promotedGroups: 1,
          promotedItems: 1,
          structureVersion: 2,
        }),
    ),
    renameGroup: vi.fn(),
  };

  return { groupRepository, useCase: new DeletePackageGroupUseCase(packageReader, groupReader, groupRepository) };
}

describe("DeletePackageGroupUseCase", () => {
  it("elimina un grupo raíz con subgrupos anidados usando la versión leída del paquete", async () => {
    const { groupRepository, useCase } = setup();

    const result = await useCase.execute({ groupId: " sala ", packageId: "pkg-1", userId: "user-1" });

    expect(result).toEqual(
      ok({ groupId: "sala", parentGroupId: null, promotedGroups: 1, promotedItems: 1, structureVersion: 2 }),
    );
    expect(groupRepository.deleteGroup).toHaveBeenCalledWith({
      expectedVersion: 9,
      groupId: "sala",
      packageId: "pkg-1",
      userId: "user-1",
    });
  });

  it("elimina un subgrupo intermedio (su contenido sube al padre)", async () => {
    const { groupRepository, useCase } = setup();

    const result = await useCase.execute({ groupId: "mesa", packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(true);
    expect(groupRepository.deleteGroup).toHaveBeenCalledWith(expect.objectContaining({ groupId: "mesa" }));
  });

  it("devuelve group_not_found sin llamar al repositorio si el grupo no está en el paquete", async () => {
    const { groupRepository, useCase } = setup();

    const result = await useCase.execute({ groupId: "otro", packageId: "pkg-1", userId: "user-1" });

    expect(!result.ok && result.error.code).toBe("package.group_not_found");
    expect(groupRepository.deleteGroup).not.toHaveBeenCalled();
  });

  it("devuelve package.not_found para un paquete ajeno o inexistente", async () => {
    const { groupRepository, useCase } = setup({ detail: null });

    const result = await useCase.execute({ groupId: "sala", packageId: "pkg-1", userId: "user-2" });

    expect(!result.ok && result.error.code).toBe("package.not_found");
    expect(groupRepository.deleteGroup).not.toHaveBeenCalled();
  });

  it("rechaza un groupId vacío", async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ groupId: "  ", packageId: "pkg-1", userId: "user-1" });

    expect(!result.ok && result.error.code).toBe("package.invalid_group");
  });

  it("propaga los errores de integridad y versión del repositorio", async () => {
    for (const code of ["package.group_integrity", "package.version_conflict"]) {
      const { useCase } = setup({ deleteResult: Promise.resolve(err(new DomainError(code, "falló"))) });

      const result = await useCase.execute({ groupId: "sala", packageId: "pkg-1", userId: "user-1" });

      expect(!result.ok && result.error.code).toBe(code);
    }
  });
});
