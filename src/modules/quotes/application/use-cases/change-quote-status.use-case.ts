import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import { validarTransicionEstado } from "../../domain/quote-status";
import type { ChangeQuoteStatusDto, QuoteDto } from "../dtos/quote.dto";
import type { QuoteRepository } from "../ports/quote-repository.port";

/**
 * Cambia el estado de una versión (DECOR-50): borrador → enviada → aceptada,
 * o → vencida. La transición se valida aquí y otra vez en el disparador de
 * `public.quotes`; los datos congelados nunca cambian.
 */
export class ChangeQuoteStatusUseCase {
  constructor(private readonly repository: Pick<QuoteRepository, "changeStatus">) {}

  async execute(dto: ChangeQuoteStatusDto): Promise<Result<QuoteDto, DomainError>> {
    if (!dto.ownerId || dto.ownerId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    const status = validarTransicionEstado(dto.quote.status, dto.status);
    if (!status.ok) return status;

    return this.repository.changeStatus({
      ownerId: dto.ownerId,
      quoteId: dto.quote.id,
      status: status.value,
    });
  }
}
