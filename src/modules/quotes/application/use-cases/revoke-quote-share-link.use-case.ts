import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import type { QuoteShareLinkDto } from "../dtos/quote.dto";
import type { QuoteShareLinkRepository } from "../ports/quote-share-link-repository.port";

export type RevokeQuoteShareLinkDto = {
  readonly ownerId: string;
  readonly quoteId: string;
};

/** Revoca el enlace activo de una cotización (DECOR-53); deja de funcionar de inmediato. */
export class RevokeQuoteShareLinkUseCase {
  constructor(private readonly repository: Pick<QuoteShareLinkRepository, "revoke">) {}

  async execute(dto: RevokeQuoteShareLinkDto): Promise<Result<QuoteShareLinkDto, DomainError>> {
    if (!dto.ownerId || dto.ownerId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    return this.repository.revoke(dto);
  }
}
