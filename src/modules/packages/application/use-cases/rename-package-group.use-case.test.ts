import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type {
  PackageGroupReader,
  PackageGroupRepository,
  PackageStructure,
} from "../ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../ports/package-reader.port";
import { RenamePackageGroupUseCase } from "./rename-package-group.use-case";

const DETAIL: PackageDetail = {
  capacityM2: 30,
  id: "pkg-1",
  items: [{ areaM2: 4, itemId: "item-1", moduleId: "mod-mesa" }],
  spaceType: "casa",
  userId: "user-1",
  version: 7,
};

const STRUCTURE: PackageStructure = {
  groups: [
    { groupId: "sala", name: "Sala", parentGroupId: null },
    { groupId: "mesa", name: "Mesa", parentGroupId: "sala" },
  ],
  itemGroupIds: { "item-1": "mesa" },
};

function setup(
  options: {
    detail?: PackageDetail | null;
    renameResult?: ReturnType<PackageGroupRepository["renameGroup"]>;
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
    deleteGroup: vi.fn(),
    renameGroup: vi.fn(
      async (command: Parameters<PackageGroupRepository["renameGroup"]>[0]) =>
        options.renameResult ?? ok({ groupId: command.groupId, name: command.name, structureVersion: 3 }),
    ),
  };

  return { groupRepository, useCase: new RenamePackageGroupUseCase(packageReader, groupReader, groupRepository) };
}

describe("RenamePackageGroupUseCase", () => {
  it("renombra con el nombre recortado y la versión leída del paquete", async () => {
    const { groupRepository, useCase } = setup();

    const result = await useCase.execute({
      groupId: "mesa",
      name: "  Mesa de regalos ",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result).toEqual(ok({ groupId: "mesa", name: "Mesa de regalos", structureVersion: 3 }));
    expect(groupRepository.renameGroup).toHaveBeenCalledWith({
      expectedVersion: 7,
      groupId: "mesa",
      name: "Mesa de regalos",
      packageId: "pkg-1",
      userId: "user-1",
    });
  });

  it.each(["", "   ", "x".repeat(81)])("rechaza el nombre %j sin llamar al repositorio", async (name) => {
    const { groupRepository, useCase } = setup();

    const result = await useCase.execute({ groupId: "sala", name, packageId: "pkg-1", userId: "user-1" });

    expect(!result.ok && result.error.code).toBe("package.invalid_group_name");
    expect(groupRepository.renameGroup).not.toHaveBeenCalled();
  });

  it("devuelve group_not_found si el grupo no está en el paquete", async () => {
    const { groupRepository, useCase } = setup();

    const result = await useCase.execute({ groupId: "otro", name: "X", packageId: "pkg-1", userId: "user-1" });

    expect(!result.ok && result.error.code).toBe("package.group_not_found");
    expect(groupRepository.renameGroup).not.toHaveBeenCalled();
  });

  it("devuelve package.not_found para un paquete ajeno o inexistente", async () => {
    const { groupRepository, useCase } = setup({ detail: null });

    const result = await useCase.execute({ groupId: "sala", name: "X", packageId: "pkg-1", userId: "user-2" });

    expect(!result.ok && result.error.code).toBe("package.not_found");
    expect(groupRepository.renameGroup).not.toHaveBeenCalled();
  });

  it("rechaza identificadores vacíos", async () => {
    const { useCase } = setup();
    const cases = [
      [{ groupId: "sala", name: "X", packageId: " ", userId: "user-1" }, "package.invalid"],
      [{ groupId: "sala", name: "X", packageId: "pkg-1", userId: "" }, "package.invalid_user"],
      [{ groupId: " ", name: "X", packageId: "pkg-1", userId: "user-1" }, "package.invalid_group"],
    ] as const;

    for (const [dto, code] of cases) {
      const result = await useCase.execute(dto);
      expect(!result.ok && result.error.code).toBe(code);
    }
  });

  it("propaga el conflicto de versión del repositorio", async () => {
    const { useCase } = setup({
      renameResult: Promise.resolve(err(new DomainError("package.version_conflict", "cambió"))),
    });

    const result = await useCase.execute({ groupId: "sala", name: "X", packageId: "pkg-1", userId: "user-1" });

    expect(!result.ok && result.error.code).toBe("package.version_conflict");
  });
});
