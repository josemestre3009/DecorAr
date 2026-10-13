import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { CreatedEventTemplateDto } from "../dtos/event-template.dto";
import type { EventTemplateRepository } from "../ports/event-template-repository.port";
import { CreateEventTemplateUseCase } from "./create-event-template.use-case";

const created: CreatedEventTemplateDto = {
  capacityM2: 80,
  colors: ["#fff"],
  eventType: "boda",
  groupCount: 2,
  id: "tpl-1",
  itemCount: 3,
  name: "Boda base",
  notes: "Notas",
  spaceType: "salonSocial",
  style: "elegante",
};

function repo(result: Awaited<ReturnType<EventTemplateRepository["createFromPackage"]>>) {
  const createFromPackage = vi.fn().mockResolvedValue(result);
  return { repository: { createFromPackage } as Pick<EventTemplateRepository, "createFromPackage">, createFromPackage };
}

describe("CreateEventTemplateUseCase", () => {
  it("recorta el nombre y delega la copia al repositorio con el dueño", async () => {
    const { repository, createFromPackage } = repo(ok(created));
    const result = await new CreateEventTemplateUseCase(repository).execute({
      name: "  Boda base  ",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result).toEqual(ok(created));
    expect(createFromPackage).toHaveBeenCalledWith({
      name: "Boda base",
      ownerId: "user-1",
      packageId: "pkg-1",
    });
  });

  it("rechaza un usuario vacío con auth.unauthenticated y no copia", async () => {
    const { repository, createFromPackage } = repo(ok(created));
    const result = await new CreateEventTemplateUseCase(repository).execute({
      name: "X",
      packageId: "pkg-1",
      userId: "   ",
    });

    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
    expect(createFromPackage).not.toHaveBeenCalled();
  });

  it("rechaza un evento vacío como package.not_found", async () => {
    const { repository, createFromPackage } = repo(ok(created));
    const result = await new CreateEventTemplateUseCase(repository).execute({
      name: "X",
      packageId: "  ",
      userId: "user-1",
    });

    expect(!result.ok && result.error.code).toBe("package.not_found");
    expect(createFromPackage).not.toHaveBeenCalled();
  });

  it("rechaza un nombre vacío o de más de 120 caracteres", async () => {
    const { repository, createFromPackage } = repo(ok(created));

    for (const name of ["", "   ", "x".repeat(121)]) {
      const result = await new CreateEventTemplateUseCase(repository).execute({
        name,
        packageId: "pkg-1",
        userId: "user-1",
      });
      expect(!result.ok && result.error.code).toBe("template.invalid_name");
    }
    expect(createFromPackage).not.toHaveBeenCalled();
  });

  it("propaga el error del repositorio", async () => {
    const { repository } = repo(err(new DomainError("package.not_found", "No encontramos este evento.")));
    const result = await new CreateEventTemplateUseCase(repository).execute({
      name: "X",
      packageId: "pkg-ajeno",
      userId: "user-1",
    });

    expect(!result.ok && result.error.code).toBe("package.not_found");
  });
});
