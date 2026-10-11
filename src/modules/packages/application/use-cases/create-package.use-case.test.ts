import { describe, expect, it, vi } from "vitest";
import { ok } from "../../../../shared/domain/result";
import type { PackageRepository } from "../ports/package-repository.port";
import { CreatePackageUseCase } from "./create-package.use-case";

describe("CreatePackageUseCase", () => {
  it("crea un paquete exitosamente cuando los datos son válidos", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = {
      create: vi.fn().mockResolvedValue(
        ok({
          capacityM2: 50,
          id: "pkg-123",
          spaceType: "salonSocial",
        }),
      ),
    };

    const useCase = new CreatePackageUseCase(mockRepo);
    const result = await useCase.execute({
      capacityM2: 50,
      spaceType: "salonSocial",
      userId: "user-123",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("pkg-123");
      expect(result.value.spaceType).toBe("salonSocial");
      expect(result.value.capacityM2).toBe(50);
    }
    expect(mockRepo.create).toHaveBeenCalledWith({
      capacityM2: 50,
      spaceType: "salonSocial",
      userId: "user-123",
    });
  });

  it("rechaza si el usuario está vacío", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    const result = await useCase.execute({
      capacityM2: 50,
      spaceType: "salonSocial",
      userId: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.invalid_user");
    }
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it("rechaza tipo de espacio no soportado", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    const result = await useCase.execute({
      capacityM2: 50,
      spaceType: "invalido",
      userId: "user-123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.invalid_space_type");
    }
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it("rechaza capacidad negativa o cero", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    const result = await useCase.execute({
      capacityM2: 0,
      spaceType: "casa",
      userId: "user-123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.invalid_capacity");
    }
  });
});
