import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import {
  normalizarNombrePlantilla,
  type RenamedEventTemplateDto,
  type RenameEventTemplateDto,
} from "../dtos/event-template.dto";
import type { EventTemplateRepository } from "../ports/event-template-repository.port";

/**
 * Renombra una plantilla privada (DECOR-44). Solo el propietario; una
 * plantilla ajena o inexistente responde `template.not_found` sin revelar que
 * existe.
 */
export class RenameEventTemplateUseCase {
  constructor(private readonly repository: Pick<EventTemplateRepository, "rename">) {}

  async execute(
    dto: RenameEventTemplateDto,
  ): Promise<Result<RenamedEventTemplateDto, DomainError>> {
    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    if (!dto.templateId || dto.templateId.trim().length === 0) {
      return err(new DomainError("template.not_found", "No encontramos esta plantilla."));
    }

    const name = normalizarNombrePlantilla(dto.name);
    if (!name.ok) return name;

    return this.repository.rename({
      name: name.value,
      ownerId: dto.userId,
      templateId: dto.templateId.trim(),
    });
  }
}
