import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { PublicQuoteDto } from "../dtos/quote.dto";
import type { SharedQuoteReader } from "../ports/quote-share-link-repository.port";
import type { ShareTokenSigner } from "../ports/share-token-signer.port";

const NOT_FOUND = new DomainError("quote.share_link_not_found", "Este enlace no está disponible.");

/**
 * Lee una cotización compartida sin sesión (DECOR-53). Un token con formato
 * inválido se rechaza sin consultar la base de datos; uno bien formado pero
 * inexistente, vencido, revocado o de una cotización que ya no es
 * `sent`/`accepted` produce exactamente el mismo error, para no revelar cuál
 * de esos motivos ocurrió.
 */
export class GetSharedQuoteUseCase {
  constructor(
    private readonly reader: Pick<SharedQuoteReader, "getSharedQuote">,
    private readonly signer: Pick<ShareTokenSigner, "isWellFormed" | "hash">,
  ) {}

  async execute(token: string): Promise<Result<PublicQuoteDto, DomainError>> {
    if (!this.signer.isWellFormed(token)) {
      return err(NOT_FOUND);
    }

    const found = await this.reader.getSharedQuote(this.signer.hash(token));
    if (!found.ok) return found;

    return found.value ? ok(found.value) : err(NOT_FOUND);
  }
}
