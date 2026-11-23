import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { QuoteTerms } from "../../domain/quote";
import type { QuoteStatus } from "../../domain/quote-status";
import type { QuoteCalculation } from "../../domain/quote-totals";
import type { QuoteDto, QuoteSummaryDto } from "../dtos/quote.dto";

type VersionPayload = {
  readonly ownerId: string;
  /** Versión del paquete leída; el RPC la compara con la bloqueada. */
  readonly expectedPackageVersion: number;
  readonly terms: QuoteTerms;
  readonly calculation: QuoteCalculation;
};

export type CreateQuoteParams = VersionPayload & { readonly packageId: string };
export type CreateQuoteVersionParams = VersionPayload & { readonly quoteId: string };
export type ChangeQuoteStatusParams = {
  readonly ownerId: string;
  readonly quoteId: string;
  readonly status: QuoteStatus;
};

/** Escrituras atómicas (RPC con service_role, que repite el control de dueño). */
export interface QuoteRepository {
  create(params: CreateQuoteParams): Promise<Result<QuoteDto, DomainError>>;
  createVersion(params: CreateQuoteVersionParams): Promise<Result<QuoteDto, DomainError>>;
  changeStatus(params: ChangeQuoteStatusParams): Promise<Result<QuoteDto, DomainError>>;
}

/** Lecturas bajo RLS del dueño. `null` = inexistente o ajena (indistinguibles). */
export interface QuoteReader {
  getQuote(quoteId: string, ownerId: string): Promise<Result<QuoteDto | null, DomainError>>;
  listQuotes(ownerId: string): Promise<Result<QuoteSummaryDto[], DomainError>>;
}
