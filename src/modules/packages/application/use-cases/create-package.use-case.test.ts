import { describe, expect, it, vi } from "vitest";
import { ok } from "../../../../shared/domain/result";
import type { PackageRepository } from "../ports/package-repository.port";
import { CreatePackageUseCase } from "./create-package.use-case";

const createdDto = {
  capacityM2: 50,
  clientName: null,
  eventDate: null,
  eventType: null,
  id: "pkg-123",
  name: "Evento boda",
  spaceType: "salonSocial" as const,
  spatial: { availableM2: 50, requiredM2: 0, status: "compatible" as const },
  venue: null,
};

describe("CreatePackageUseCase", () => {
  it("crea un evento sólo con nombre, sin espacio ni área", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = {
      create: vi.fn().mockResolvedValue(ok(createdDto)),
    };

    const useCase = new CreatePackageUseCase(mockRepo);
    const result = await useCase.execute({ name: "  Evento boda  ", userId: "user-123" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("pkg-123");
      expect(result.value.name).toBe("Evento boda");
    }
    expect(mockRepo.create).toHaveBeenCalledWith({
      capacityM2: null,
      clientName: null,
      eventDate: null,
      eventType: null,
      name: "Evento boda",
      spaceType: null,
      userId: "user-123",
      venue: null,
    });
  });

  it("normaliza y conserva los metadatos opcionales", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = {
      create: vi.fn().mockResolvedValue(ok(createdDto)),
    };

    const useCase = new CreatePackageUseCase(mockRepo);
    await useCase.execute({
      capacityM2: 42.5,
      clientName: "  Ana  ",
      eventDate: "2026-11-20",
      eventType: "  Boda  ",
      name: "Fiesta",
      spaceType: "casa",
      userId: "user-1",
      venue: "  Salón Norte  ",
    });

    expect(mockRepo.create).toHaveBeenCalledWith({
      capacityM2: 42.5,
      clientName: "Ana",
      eventDate: "2026-11-20",
      eventType: "Boda",
      name: "Fiesta",
      spaceType: "casa",
      userId: "user-1",
      venue: "Salón Norte",
    });
  });

  it("rechaza si el usuario está vacío", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    const result = await useCase.execute({ name: "Evento", userId: "   " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.invalid_user");
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it("rechaza un nombre vacío o sólo espacios", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    for (const name of ["", "   "]) {
      const result = await useCase.execute({ name, userId: "user-1" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.invalid_name");
    }
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it("rechaza un nombre de más de 120 caracteres", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    const result = await useCase.execute({ name: "x".repeat(121), userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.invalid_name");
  });

  it("rechaza tipo de espacio no soportado", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    const result = await useCase.execute({ name: "Evento", spaceType: "invalido", userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.invalid_space_type");
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it("rechaza capacidad negativa, cero o no finita", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    for (const capacityM2 of [0, -10, NaN, Infinity]) {
      const result = await useCase.execute({ capacityM2, name: "Evento", userId: "user-1" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.invalid_capacity");
    }
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it("rechaza una fecha inválida", async () => {
    const mockRepo: Pick<PackageRepository, "create"> = { create: vi.fn() };
    const useCase = new CreatePackageUseCase(mockRepo);

    const result = await useCase.execute({ eventDate: "20-11-2026", name: "Evento", userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.invalid_event_date");
  });
});
