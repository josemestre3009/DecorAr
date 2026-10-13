import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import type { EventTemplateDto } from "../dtos/event-template.dto";
import type { EventTemplateReader } from "../ports/event-template-repository.port";

/**
 * Lista las plantillas privadas del usuario (DECOR-44). El lector filtra por
 * `owner_id` aunque RLS también aplique, así que nunca se listan ajenas.
 */
export class ListOwnedEventTemplatesUseCase {
  constructor(private readonly reader: Pick<EventTemplateReader, "listByOwner">) {}

  async execute(userId: string): Promise<Result<readonly EventTemplateDto[], DomainError>> {
    if (!userId || userId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    return this.reader.listByOwner(userId);
  }
}
