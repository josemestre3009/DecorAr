import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import type { DeleteEventTemplateDto } from "../dtos/event-template.dto";
import type { EventTemplateRepository } from "../ports/event-template-repository.port";

/**
 * Elimina una plantilla privada (DECOR-44). Los eventos ya creados desde ella
 * permanecen intactos. Solo el propietario; una plantilla ajena o inexistente
 * responde `template.not_found`.
 */
export class DeleteEventTemplateUseCase {
  constructor(private readonly repository: Pick<EventTemplateRepository, "delete">) {}

  async execute(dto: DeleteEventTemplateDto): Promise<Result<boolean, DomainError>> {
    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    if (!dto.templateId || dto.templateId.trim().length === 0) {
      return err(new DomainError("template.not_found", "No encontramos esta plantilla."));
    }

    return this.repository.delete({
      ownerId: dto.userId,
      templateId: dto.templateId.trim(),
    });
  }
}
