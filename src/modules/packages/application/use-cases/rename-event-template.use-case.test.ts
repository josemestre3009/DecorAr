import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { EventTemplateRepository } from "../ports/event-template-repository.port";
import { RenameEventTemplateUseCase } from "./rename-event-template.use-case";

const renamed = { id: "tpl-1", name: "Nuevo nombre" };

function repo(result: Awaited<ReturnType<EventTemplateRepository["rename"]>>) {
  const rename = vi.fn().mockResolvedValue(result);
  return { repository: { rename } as Pick<EventTemplateRepository, "rename">, rename };
}

describe("RenameEventTemplateUseCase", () => {
  it("recorta el nombre y delega con el dueño y la plantilla", async () => {
    const { repository, rename } = repo(ok(renamed));
    const result = await new RenameEventTemplateUseCase(repository).execute({
      name: "  Nuevo nombre  ",
      templateId: "tpl-1",
      userId: "user-1",
    });

    expect(result).toEqual(ok(renamed));
    expect(rename).toHaveBeenCalledWith({ name: "Nuevo nombre", ownerId: "user-1", templateId: "tpl-1" });
  });

  it("rechaza usuario vacío, plantilla vacía y nombre inválido sin llamar al repositorio", async () => {
    const { repository, rename } = repo(ok(renamed));

    expect(
      await new RenameEventTemplateUseCase(repository).execute({ name: "X", templateId: "tpl-1", userId: "" }),
    ).toMatchObject({ error: { code: "auth.unauthenticated" } });

    expect(
      await new RenameEventTemplateUseCase(repository).execute({ name: "X", templateId: "  ", userId: "user-1" }),
    ).toMatchObject({ error: { code: "template.not_found" } });

    expect(
      await new RenameEventTemplateUseCase(repository).execute({ name: "x".repeat(121), templateId: "tpl-1", userId: "user-1" }),
    ).toMatchObject({ error: { code: "template.invalid_name" } });

    expect(rename).not.toHaveBeenCalled();
  });

  it("propaga template.not_found del repositorio", async () => {
    const { repository } = repo(err(new DomainError("template.not_found", "No encontramos esta plantilla.")));
    const result = await new RenameEventTemplateUseCase(repository).execute({
      name: "X",
      templateId: "tpl-ajena",
      userId: "user-1",
    });

    expect(!result.ok && result.error.code).toBe("template.not_found");
  });
});
