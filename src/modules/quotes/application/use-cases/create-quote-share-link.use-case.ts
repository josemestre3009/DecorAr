import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import { resolveShareExpiry, validarCotizacionCompartible } from "../../domain/quote-share-link";
import type { CreatedQuoteShareLinkDto, QuoteDto } from "../dtos/quote.dto";
import type { QuoteShareLinkRepository } from "../ports/quote-share-link-repository.port";
import type { ShareTokenSigner } from "../ports/share-token-signer.port";

export type CreateQuoteShareLinkDto = {
  readonly ownerId: string;
  readonly quote: QuoteDto;
};

/**
 * Crea (o reutiliza) el enlace público de una versión de cotización
 * (DECOR-53). Solo cotizaciones `sent`/`accepted`; la RPC vuelve a
 * verificarlo y es quien de verdad decide si reutiliza un enlace vigente o
 * lo reemplaza. El token se calcula aquí a partir del `id` real que devuelve
 * el repositorio (nuevo o reutilizado), nunca se persiste.
 */
export class CreateQuoteShareLinkUseCase {
  constructor(
    private readonly repository: Pick<QuoteShareLinkRepository, "create">,
    private readonly signer: Pick<ShareTokenSigner, "sign" | "hash">,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(dto: CreateQuoteShareLinkDto): Promise<Result<CreatedQuoteShareLinkDto, DomainError>> {
    if (!dto.ownerId || dto.ownerId.trim().length === 0) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    const shareable = validarCotizacionCompartible(dto.quote.status);
    if (!shareable.ok) return shareable;

    const expiry = resolveShareExpiry(dto.quote.validUntil, this.clock.now());
    if (!expiry.ok) return expiry;

    const linkId = this.ids.generate();
    const token = this.signer.sign(linkId);

    const created = await this.repository.create({
      expiresAt: expiry.value,
      linkId,
      ownerId: dto.ownerId,
      quoteId: dto.quote.id,
      tokenHash: this.signer.hash(token),
    });
    if (!created.ok) return created;

    // El enlace devuelto puede ser uno reutilizado y vigente, con otro `id`
    // que `linkId`: el token siempre se recalcula a partir del `id` real, que
    // es determinista, en vez de asumir que coincide con el propuesto.
    return { ok: true, value: { ...created.value, token: this.signer.sign(created.value.id) } };
  }
}
