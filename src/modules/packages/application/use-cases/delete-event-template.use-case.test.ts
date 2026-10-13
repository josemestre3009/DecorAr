import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { EventTemplateRepository } from "../ports/event-template-repository.port";
import { DeleteEventTemplateUseCase } from "./delete-event-template.use-case";

function repo(result: Awaited<ReturnType<EventTemplateRepository["delete"]>>) {
  const remove = vi.fn().mockResolvedValue(result);
  return { repository: { delete: remove } as Pick<EventTemplateRepository, "delete">, remove };
}

describe("DeleteEventTemplateUseCase", () => {
  it("delega con el dueño y el id de la plantilla", async () => {
    const { repository, remove } = repo(ok(true));
    const result = await new DeleteEventTemplateUseCase(repository).execute({
      templateId: "tpl-1",
      userId: "user-1",
    });

    expect(result).toEqual(ok(true));
    expect(remove).toHaveBeenCalledWith({ ownerId: "user-1", templateId: "tpl-1" });
  });

  it("rechaza usuario o plantilla vacíos sin llamar al repositorio", async () => {
    const { repository, remove } = repo(ok(true));

    expect(
      await new DeleteEventTemplateUseCase(repository).execute({ templateId: "tpl-1", userId: " " }),
    ).toMatchObject({ error: { code: "auth.unauthenticated" } });

    expect(
      await new DeleteEventTemplateUseCase(repository).execute({ templateId: "  ", userId: "user-1" }),
    ).toMatchObject({ error: { code: "template.not_found" } });

    expect(remove).not.toHaveBeenCalled();
  });

  it("propaga template.not_found del repositorio", async () => {
    const { repository } = repo(err(new DomainError("template.not_found", "No encontramos esta plantilla.")));
    const result = await new DeleteEventTemplateUseCase(repository).execute({
      templateId: "tpl-ajena",
      userId: "user-1",
    });

    expect(!result.ok && result.error.code).toBe("template.not_found");
  });
});
