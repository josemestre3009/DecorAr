import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { InstantiatedEventDto } from "../dtos/event-template.dto";
import type { EventTemplateRepository } from "../ports/event-template-repository.port";
import { InstantiateEventFromTemplateUseCase } from "./instantiate-event-from-template.use-case";

const event: InstantiatedEventDto = {
  capacityM2: 80,
  colors: [],
  eventType: "boda",
  groupCount: 2,
  id: "pkg-new",
  itemCount: 3,
  name: "Nuevo evento",
  notes: "",
  spaceType: "salonSocial",
  style: null,
  version: 1,
};

function repo(result: Awaited<ReturnType<EventTemplateRepository["instantiate"]>>) {
  const instantiate = vi.fn().mockResolvedValue(result);
  return { repository: { instantiate } as Pick<EventTemplateRepository, "instantiate">, instantiate };
}

describe("InstantiateEventFromTemplateUseCase", () => {
  it("recorta el nombre del evento y delega con el dueño y la plantilla", async () => {
    const { repository, instantiate } = repo(ok(event));
    const result = await new InstantiateEventFromTemplateUseCase(repository).execute({
      name: "  Nuevo evento  ",
      templateId: "tpl-1",
      userId: "user-1",
    });

    expect(result).toEqual(ok(event));
    expect(instantiate).toHaveBeenCalledWith({
      name: "Nuevo evento",
      ownerId: "user-1",
      templateId: "tpl-1",
    });
  });

  it("rechaza un usuario vacío con auth.unauthenticated", async () => {
    const { repository, instantiate } = repo(ok(event));
    const result = await new InstantiateEventFromTemplateUseCase(repository).execute({
      name: "X",
      templateId: "tpl-1",
      userId: "",
    });

    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
    expect(instantiate).not.toHaveBeenCalled();
  });

  it("rechaza una plantilla vacía como template.not_found", async () => {
    const { repository, instantiate } = repo(ok(event));
    const result = await new InstantiateEventFromTemplateUseCase(repository).execute({
      name: "X",
      templateId: "  ",
      userId: "user-1",
    });

    expect(!result.ok && result.error.code).toBe("template.not_found");
    expect(instantiate).not.toHaveBeenCalled();
  });

  it("valida el nombre del evento con el código del evento (package.invalid_name)", async () => {
    const { repository, instantiate } = repo(ok(event));

    for (const name of ["", "   ", "x".repeat(121)]) {
      const result = await new InstantiateEventFromTemplateUseCase(repository).execute({
        name,
        templateId: "tpl-1",
        userId: "user-1",
      });
      expect(!result.ok && result.error.code).toBe("package.invalid_name");
    }
    expect(instantiate).not.toHaveBeenCalled();
  });

  it("propaga template.not_found del repositorio (plantilla ajena)", async () => {
    const { repository } = repo(err(new DomainError("template.not_found", "No encontramos esta plantilla.")));
    const result = await new InstantiateEventFromTemplateUseCase(repository).execute({
      name: "X",
      templateId: "tpl-ajena",
      userId: "user-1",
    });

    expect(!result.ok && result.error.code).toBe("template.not_found");
  });
});
