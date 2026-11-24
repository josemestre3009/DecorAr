import { randomUUID } from "node:crypto";

import type { CreateQuoteShareLinkUseCase } from "../../modules/quotes/application/use-cases/create-quote-share-link.use-case";
import type { GetQuoteShareLinkUseCase } from "../../modules/quotes/application/use-cases/get-quote-share-link.use-case";
import type { RevokeQuoteShareLinkUseCase } from "../../modules/quotes/application/use-cases/revoke-quote-share-link.use-case";
import type { QuoteReader } from "../../modules/quotes/application/ports/quote-repository.port";
import type { SessionGateway } from "../../shared/application/ports";
import { checkQuoteAccess } from "./quote-access";

const CORRELATION_ID_HEADER = "x-correlation-id";

export type QuoteShareLinkControllerDependencies = {
  readonly sessionGateway: Pick<SessionGateway, "currentUser">;
  readonly quoteReader: Pick<QuoteReader, "getQuote">;
  readonly createQuoteShareLink: Pick<CreateQuoteShareLinkUseCase, "execute">;
  readonly getQuoteShareLink: Pick<GetQuoteShareLinkUseCase, "execute">;
  readonly revokeQuoteShareLink: Pick<RevokeQuoteShareLinkUseCase, "execute">;
  readonly publicAppUrl: string;
  readonly defaultHeaders?: Record<string, string>;
};

function correlationIdFor(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER);
  return provided && provided.trim().length > 0 ? provided.trim() : randomUUID();
}

/** Estado HTTP de los errores del enlace; el detalle de un 500 nunca se filtra. */
export function shareLinkErrorStatus(code: string): number {
  if (code === "auth.unauthenticated") return 401;
  if (code === "quote.not_found" || code === "quote.share_link_not_found") return 404;
  if (code === "quote.persistence_error" || code === "internal_error" || code.endsWith(".persistence_error")) {
    return 500;
  }
  if (code.startsWith("quote.")) return 422;
  return 400;
}

/**
 * HTTP boundary del enlace público de cotizaciones (DECOR-53). Reutiliza
 * `checkQuoteAccess`: una cotización ajena, inexistente o un id mal formado
 * responden 404 indistinguible, igual que el resto de la API de cotizaciones.
 * Las rutas sirven solo al propietario; la lectura sin sesión vive en
 * `GetSharedQuoteUseCase`, consumido por la página pública, no por este
 * controlador.
 */
export class QuoteShareLinkController {
  private readonly defaultHeaders: Record<string, string>;

  constructor(private readonly deps: QuoteShareLinkControllerDependencies) {
    this.defaultHeaders = deps.defaultHeaders ?? {};
  }

  private headers(correlationId: string): Record<string, string> {
    return { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };
  }

  private errorResponse(correlationId: string, code: string, message: string, logLabel: string): Response {
    const status = shareLinkErrorStatus(code);
    const headers = this.headers(correlationId);

    if (status === 500) {
      console.error(`[QuoteShareLinkController.${logLabel}] (${correlationId}):`, code, message);
      return this.internalError(correlationId);
    }

    return Response.json({ error: { code, message } }, { headers, status });
  }

  private internalError(correlationId: string): Response {
    return Response.json(
      { error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { headers: this.headers(correlationId), status: 500 },
    );
  }

  private access(correlationId: string, quoteId: string) {
    return checkQuoteAccess(
      {
        currentUser: () => this.deps.sessionGateway.currentUser(),
        reader: this.deps.quoteReader,
      },
      quoteId,
      this.headers(correlationId),
    );
  }

  private urlFor(token: string): string {
    return new URL(`/c/${encodeURIComponent(token)}`, this.deps.publicAppUrl).toString();
  }

  /** `POST /api/quotes/{quoteId}/share-link`: crea o reutiliza el enlace activo. */
  async handleCreate(request: Request, quoteId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, quoteId);
      if (!access.ok) return access.response;

      const result = await this.deps.createQuoteShareLink.execute({ ownerId: access.user.id, quote: access.quote });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "create");
      }

      const { token, ...link } = result.value;
      console.info(`[QuoteShareLinkController.create] (${correlationId}): linkId=${link.id} quoteId=${quoteId}`);

      return Response.json(
        { ...link, url: this.urlFor(token) },
        { headers: this.headers(correlationId), status: 201 },
      );
    } catch (cause) {
      console.error(`[QuoteShareLinkController.create] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }

  /** `GET /api/quotes/{quoteId}/share-link`: enlace activo, o `null`. */
  async handleGet(request: Request, quoteId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, quoteId);
      if (!access.ok) return access.response;

      const result = await this.deps.getQuoteShareLink.execute({ ownerId: access.user.id, quoteId });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "get");
      }

      if (!result.value) {
        return Response.json({ link: null }, { headers: this.headers(correlationId) });
      }

      const { token, ...link } = result.value;
      return Response.json(
        { link: { ...link, url: this.urlFor(token) } },
        { headers: this.headers(correlationId) },
      );
    } catch (cause) {
      console.error(`[QuoteShareLinkController.get] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }

  /** `DELETE /api/quotes/{quoteId}/share-link`: revoca el enlace activo. */
  async handleRevoke(request: Request, quoteId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, quoteId);
      if (!access.ok) return access.response;

      const result = await this.deps.revokeQuoteShareLink.execute({ ownerId: access.user.id, quoteId });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "revoke");
      }

      console.info(`[QuoteShareLinkController.revoke] (${correlationId}): linkId=${result.value.id} quoteId=${quoteId}`);

      return Response.json(result.value, { headers: this.headers(correlationId) });
    } catch (cause) {
      console.error(`[QuoteShareLinkController.revoke] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }
}
