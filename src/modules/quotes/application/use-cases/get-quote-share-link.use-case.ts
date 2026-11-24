import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { CreatedQuoteShareLinkDto } from "../dtos/quote.dto";
import type { QuoteShareLinkRepository } from "../ports/quote-share-link-repository.port";
import type { ShareTokenSigner } from "../ports/share-token-signer.port";

export type GetQuoteShareLinkDto = {
  readonly ownerId: string;
  readonly quoteId: string;
};

/**
 * Enlace activo de una cotización, con el token recalculado (DECOR-53). El
 * propietario puede volver a copiar el mismo enlace sin que el servidor lo
 * haya guardado en texto plano. `null` cuando no hay ninguno activo.
 */
export class GetQuoteShareLinkUseCase {
  constructor(
    private readonly repository: Pick<QuoteShareLinkRepository, "getActive">,
    private readonly signer: Pick<ShareTokenSigner, "sign">,
  ) {}

  async execute(dto: GetQuoteShareLinkDto): Promise<Result<CreatedQuoteShareLinkDto | null, DomainError>> {
    if (!dto.ownerId || dto.ownerId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    const found = await this.repository.getActive(dto);
    if (!found.ok) return found;
    if (!found.value) return ok(null);

    return ok({ ...found.value, token: this.signer.sign(found.value.id) });
  }
}
