import type { Clock } from "../../../../shared/application/ports";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import { validarTerminosCotizacion } from "../../domain/quote-terms";
import { calculateQuote } from "../../domain/quote-totals";
import type { CreateQuoteVersionDto, QuoteDto } from "../dtos/quote.dto";
import type { QuoteRepository } from "../ports/quote-repository.port";
import type { QuoteSourceReader } from "../ports/quote-source-reader.port";
import { todayIso } from "../today";

const packageMissing = () =>
  err(
    new DomainError(
      "quote.package_missing",
      "El evento de esta cotización ya no existe; no se puede crear una versión nueva.",
    ),
  );

/**
 * Crea una versión nueva de una cotización existente (DECOR-50). Toma otra
 * vez la instantánea del evento actual con los términos nuevos; conserva el
 * número y no modifica ninguna versión anterior. `dto.quote` es la versión ya
 * autorizada para el dueño (puede ser cualquiera del mismo número).
 */
export class CreateQuoteVersionUseCase {
  constructor(
    private readonly source: QuoteSourceReader,
    private readonly repository: Pick<QuoteRepository, "createVersion">,
    private readonly clock: Clock,
  ) {}

  async execute(dto: CreateQuoteVersionDto): Promise<Result<QuoteDto, DomainError>> {
    if (!dto.ownerId || dto.ownerId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    const terms = validarTerminosCotizacion(dto.terms, todayIso(this.clock));
    if (!terms.ok) return terms;

    if (!dto.quote.packageId) return packageMissing();

    const source = await this.source.read(dto.quote.packageId, dto.ownerId);
    if (!source.ok) return source;
    if (!source.value) return packageMissing();

    const calculation = calculateQuote(source.value.lines, terms.value);
    if (!calculation.ok) return calculation;

    return this.repository.createVersion({
      calculation: calculation.value,
      expectedPackageVersion: source.value.packageVersion,
      ownerId: dto.ownerId,
      quoteId: dto.quote.id,
      terms: terms.value,
    });
  }
}
