import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { QuoteTerms } from "../../domain/quote";
import type { QuoteStatus } from "../../domain/quote-status";
import type { QuoteCalculation } from "../../domain/quote-totals";
import type { CreatedQuoteResultDto, QuoteDto, QuoteSummaryDto } from "../dtos/quote.dto";

type VersionPayload = {
  readonly ownerId: string;
  /** Versión del paquete leída; el RPC la compara con la bloqueada. */
  readonly expectedPackageVersion: number;
  readonly terms: QuoteTerms;
  readonly calculation: QuoteCalculation;
  /** UUID validado de `Idempotency-Key` (DECOR-55). */
  readonly idempotencyKey: string;
  /** Solicitud canónica (`quoteRequestFingerprint`); el RPC guarda solo su sha256. */
  readonly requestFingerprint: string;
};

export type CreateQuoteParams = VersionPayload & { readonly packageId: string };
export type CreateQuoteVersionParams = VersionPayload & {
  readonly quoteId: string;
  /** Última versión que vio el cliente; si ya existe otra más nueva, `quote.version_conflict`. */
  readonly expectedVersion: number;
};
export type ChangeQuoteStatusParams = {
  readonly ownerId: string;
  readonly quoteId: string;
  readonly status: QuoteStatus;
  /** Estado que vio el cliente; si cambió entretanto, `quote.status_conflict`. */
  readonly expectedStatus: QuoteStatus;
};

/** Escrituras atómicas (RPC con service_role, que repite el control de dueño). */
export interface QuoteRepository {
  create(params: CreateQuoteParams): Promise<Result<CreatedQuoteResultDto, DomainError>>;
  createVersion(params: CreateQuoteVersionParams): Promise<Result<CreatedQuoteResultDto, DomainError>>;
  changeStatus(params: ChangeQuoteStatusParams): Promise<Result<QuoteDto, DomainError>>;
}

/** Lecturas bajo RLS del dueño. `null` = inexistente o ajena (indistinguibles). */
export interface QuoteReader {
  getQuote(quoteId: string, ownerId: string): Promise<Result<QuoteDto | null, DomainError>>;
  /** Versión más nueva del número (DECOR-55: el `expectedVersion` correcto al versionar desde cualquier versión). */
  latestVersion(ownerId: string, quoteNumber: number): Promise<Result<number | null, DomainError>>;
  listQuotes(ownerId: string): Promise<Result<QuoteSummaryDto[], DomainError>>;
}
