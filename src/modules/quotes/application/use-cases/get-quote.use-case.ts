import type { SessionGateway } from "../../../../shared/application/ports";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { QuoteDto } from "../dtos/quote.dto";
import type { QuoteReader } from "../ports/quote-repository.port";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Lee una versión de cotización para su dueño (vista previa, DECOR-51). Sin
 * sesión responde `auth.unauthenticated`; un id mal formado, una cotización
 * inexistente o ajena responden igual `quote.not_found`, como en
 * `checkQuoteAccess`, para no revelar que existe.
 */
export class GetQuoteUseCase {
  constructor(
    private readonly session: Pick<SessionGateway, "currentUser">,
    private readonly reader: Pick<QuoteReader, "getQuote">,
  ) {}

  async execute(quoteId: string): Promise<Result<QuoteDto, DomainError>> {
    const user = await this.session.currentUser();

    if (!user) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    if (!UUID.test(quoteId)) {
      return notFound();
    }

    const found = await this.reader.getQuote(quoteId, user.id);

    if (!found.ok) {
      return found;
    }

    return found.value ? ok(found.value) : notFound();
  }
}

function notFound(): Result<never, DomainError> {
  return err(new DomainError("quote.not_found", "No encontramos esta cotización."));
}
