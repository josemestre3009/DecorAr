import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { ClonedPackageDto } from "../dtos/package.dto";
import type { PackageRepository } from "../ports/package-repository.port";
import { ClonePackageUseCase } from "./clone-package.use-case";

describe("ClonePackageUseCase", () => {
  const validSourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const validUserId = "11111111-1111-4111-8111-111111111111";

  it("rechaza si el userId no está presente", async () => {
    const repository: PackageRepository = {
      create: vi.fn(),
      clone: vi.fn(),
    };
    const useCase = new ClonePackageUseCase(repository);

    const result = await useCase.execute({
      sourcePackageId: validSourceId,
      userId: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("auth.unauthenticated");
    }
    expect(repository.clone).not.toHaveBeenCalled();
  });

  it("rechaza si el sourcePackageId tiene formato inválido", async () => {
    const repository: PackageRepository = {
      create: vi.fn(),
      clone: vi.fn(),
    };
    const useCase = new ClonePackageUseCase(repository);

    const result = await useCase.execute({
      sourcePackageId: "not-a-uuid",
      userId: validUserId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.not_found");
    }
    expect(repository.clone).not.toHaveBeenCalled();
  });

  it("delega la clonación al repositorio cuando los datos son válidos", async () => {
    const clonedDto: ClonedPackageDto = {
      capacityM2: 50,
      colors: ["#ffffff", "#000000"],
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      itemCount: 3,
      notes: "Clon para evento nocturno",
      spaceType: "salonSocial",
      style: "elegante",
      version: 1,
    };

    const repository: PackageRepository = {
      create: vi.fn(),
      clone: vi.fn().mockResolvedValue(ok(clonedDto)),
    };
    const useCase = new ClonePackageUseCase(repository);

    const result = await useCase.execute({
      sourcePackageId: validSourceId,
      userId: validUserId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(clonedDto.id);
      expect(result.value.itemCount).toBe(3);
      expect(result.value.version).toBe(1);
    }
    expect(repository.clone).toHaveBeenCalledWith({
      sourcePackageId: validSourceId,
      userId: validUserId,
    });
  });

  it("propaga el error si el repositorio falla", async () => {
    const repository: PackageRepository = {
      create: vi.fn(),
      clone: vi.fn().mockResolvedValue(err(new DomainError("package.not_found", "Paquete no encontrado"))),
    };
    const useCase = new ClonePackageUseCase(repository);

    const result = await useCase.execute({
      sourcePackageId: validSourceId,
      userId: validUserId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.not_found");
    }
  });
});
