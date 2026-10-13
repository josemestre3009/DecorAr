import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import { normalizarNombreEvento } from "../../domain/event-metadata";
import type {
  InstantiateEventFromTemplateDto,
  InstantiatedEventDto,
} from "../dtos/event-template.dto";
import type { EventTemplateRepository } from "../ports/event-template-repository.port";

/**
 * Crea un evento nuevo desde una plantilla privada (DECOR-44). El nombre del
 * evento es obligatorio; el repositorio comprueba la propiedad de la plantilla
 * dentro de la transacción y una plantilla ajena o inexistente responde
 * `template.not_found`.
 */
export class InstantiateEventFromTemplateUseCase {
  constructor(private readonly repository: Pick<EventTemplateRepository, "instantiate">) {}

  async execute(
    dto: InstantiateEventFromTemplateDto,
  ): Promise<Result<InstantiatedEventDto, DomainError>> {
    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    if (!dto.templateId || dto.templateId.trim().length === 0) {
      return err(new DomainError("template.not_found", "No encontramos esta plantilla."));
    }

    const name = normalizarNombreEvento(dto.name);
    if (!name.ok) return name;

    return this.repository.instantiate({
      name: name.value,
      ownerId: dto.userId,
      templateId: dto.templateId.trim(),
    });
  }
}
