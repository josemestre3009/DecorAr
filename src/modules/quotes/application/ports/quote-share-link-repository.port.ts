import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { PublicQuoteDto, QuoteShareLinkDto } from "../dtos/quote.dto";

export type CreateQuoteShareLinkParams = {
  readonly ownerId: string;
  readonly quoteId: string;
  readonly linkId: string;
  readonly tokenHash: Uint8Array;
  readonly expiresAt: Date;
};

export type OwnedQuoteShareLinkParams = {
  readonly ownerId: string;
  readonly quoteId: string;
};

/** Escrituras y lecturas de dueño del enlace (RPC con `service_role`). */
export interface QuoteShareLinkRepository {
  create(params: CreateQuoteShareLinkParams): Promise<Result<QuoteShareLinkDto, DomainError>>;
  getActive(params: OwnedQuoteShareLinkParams): Promise<Result<QuoteShareLinkDto | null, DomainError>>;
  revoke(params: OwnedQuoteShareLinkParams): Promise<Result<QuoteShareLinkDto, DomainError>>;
}

/** Lectura pública por hash de token; `null` cubre cualquier motivo de rechazo. */
export interface SharedQuoteReader {
  getSharedQuote(tokenHash: Uint8Array): Promise<Result<PublicQuoteDto | null, DomainError>>;
}
