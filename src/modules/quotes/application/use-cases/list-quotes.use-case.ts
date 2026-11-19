import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import type { QuoteSummaryDto } from "../dtos/quote.dto";
import type { QuoteReader } from "../ports/quote-repository.port";

/** Lista las cotizaciones del dueño (todas sus versiones), más recientes primero. */
export class ListQuotesUseCase {
  constructor(private readonly reader: Pick<QuoteReader, "listQuotes">) {}

  async execute(ownerId: string): Promise<Result<QuoteSummaryDto[], DomainError>> {
    if (!ownerId || ownerId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    return this.reader.listQuotes(ownerId);
  }
}
