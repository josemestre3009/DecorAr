import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import { isQuoteStatus, QUOTE_STATUSES, validarTransicionEstado } from "../../domain/quote-status";
import type { ChangeQuoteStatusDto, QuoteDto } from "../dtos/quote.dto";
import type { QuoteRepository } from "../ports/quote-repository.port";

/**
 * Cambia el estado de una versión (DECOR-50): borrador → enviada → aceptada,
 * o → vencida. La transición se valida aquí y otra vez en el disparador de
 * `public.quotes`; los datos congelados nunca cambian.
 *
 * DECOR-55: el cliente envía `expectedStatus`, el estado que vio. Si la
 * versión ya está en el estado pedido (un reintento), se devuelve tal cual
 * sin escribir; si cambió a otro estado entretanto, `quote.status_conflict`
 * con el estado actual. El RPC repite ambas comprobaciones con la fila
 * bloqueada.
 */
export class ChangeQuoteStatusUseCase {
  constructor(private readonly repository: Pick<QuoteRepository, "changeStatus">) {}

  async execute(dto: ChangeQuoteStatusDto): Promise<Result<QuoteDto, DomainError>> {
    if (!dto.ownerId || dto.ownerId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    if (!isQuoteStatus(dto.status) || !isQuoteStatus(dto.expectedStatus)) {
      return err(
        new DomainError(
          "quote.invalid_status",
          `status y expectedStatus deben ser uno de: ${QUOTE_STATUSES.join(", ")}.`,
        ),
      );
    }

    if (dto.quote.status === dto.status) return ok(dto.quote);

    if (dto.quote.status !== dto.expectedStatus) {
      return err(
        new DomainError(
          "quote.status_conflict",
          "La cotización cambió de estado mientras la revisabas. Recarga para ver el estado actual.",
          undefined,
          { currentStatus: dto.quote.status },
        ),
      );
    }

    const status = validarTransicionEstado(dto.quote.status, dto.status);
    if (!status.ok) return status;

    return this.repository.changeStatus({
      expectedStatus: dto.expectedStatus,
      ownerId: dto.ownerId,
      quoteId: dto.quote.id,
      status: status.value,
    });
  }
}
