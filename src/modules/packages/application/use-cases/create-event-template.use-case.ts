import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import {
  normalizarNombrePlantilla,
  type CreatedEventTemplateDto,
  type CreateEventTemplateDto,
} from "../dtos/event-template.dto";
import type { EventTemplateRepository } from "../ports/event-template-repository.port";

/**
 * Guarda un evento como plantilla privada (DECOR-44). Copia la configuración
 * decorativa y excluye cliente, fecha y lugar. El repositorio filtra por dueño
 * y un evento ajeno o inexistente responde `package.not_found` sin revelar nada.
 */
export class CreateEventTemplateUseCase {
  constructor(
    private readonly repository: Pick<EventTemplateRepository, "createFromPackage">,
  ) {}

  async execute(
    dto: CreateEventTemplateDto,
  ): Promise<Result<CreatedEventTemplateDto, DomainError>> {
    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.not_found", "No encontramos este evento."));
    }

    const name = normalizarNombrePlantilla(dto.name);
    if (!name.ok) return name;

    return this.repository.createFromPackage({
      name: name.value,
      ownerId: dto.userId,
      packageId: dto.packageId.trim(),
    });
  }
}
