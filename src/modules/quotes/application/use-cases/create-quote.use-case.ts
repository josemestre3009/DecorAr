import type { Clock } from "../../../../shared/application/ports";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import { parseIdempotencyKey } from "../../domain/idempotency-key";
import { validarTerminosCotizacion } from "../../domain/quote-terms";
import { calculateQuote } from "../../domain/quote-totals";
import type { CreatedQuoteResultDto, CreateQuoteDto } from "../dtos/quote.dto";
import type { QuoteRepository } from "../ports/quote-repository.port";
import type { QuoteSourceReader } from "../ports/quote-source-reader.port";
import { quoteRequestFingerprint } from "../quote-request-fingerprint";
import { todayIso } from "../today";

/**
 * Crea la versión 1 de una cotización (DECOR-50): valida los términos, toma
 * la instantánea del evento, calcula los totales en servidor y la guarda de
 * forma atómica. Un evento ajeno o inexistente responde `package.not_found`.
 * Un reintento con la misma `Idempotency-Key` devuelve la cotización ya
 * creada, sin asignar otro número (DECOR-55).
 */
export class CreateQuoteUseCase {
  constructor(
    private readonly source: QuoteSourceReader,
    private readonly repository: Pick<QuoteRepository, "create">,
    private readonly clock: Clock,
  ) {}

  async execute(dto: CreateQuoteDto): Promise<Result<CreatedQuoteResultDto, DomainError>> {
    if (!dto.ownerId || dto.ownerId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    const idempotencyKey = parseIdempotencyKey(dto.idempotencyKey);
    if (!idempotencyKey.ok) return idempotencyKey;

    const terms = validarTerminosCotizacion(dto.terms, todayIso(this.clock));
    if (!terms.ok) return terms;

    const source = await this.source.read(dto.packageId, dto.ownerId);
    if (!source.ok) return source;
    if (!source.value) {
      return err(new DomainError("package.not_found", "No encontramos este evento."));
    }

    const calculation = calculateQuote(source.value.lines, terms.value);
    if (!calculation.ok) return calculation;

    return this.repository.create({
      calculation: calculation.value,
      expectedPackageVersion: source.value.packageVersion,
      idempotencyKey: idempotencyKey.value,
      ownerId: dto.ownerId,
      packageId: source.value.packageId,
      requestFingerprint: quoteRequestFingerprint({
        operation: "create_quote",
        packageId: source.value.packageId,
        terms: terms.value,
      }),
      terms: terms.value,
    });
  }
}
