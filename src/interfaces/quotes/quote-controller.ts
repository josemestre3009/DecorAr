import { randomUUID } from "node:crypto";

import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { QuotePdfRenderer } from "../../modules/quotes/application/ports/quote-pdf-renderer.port";
import type { QuoteReader } from "../../modules/quotes/application/ports/quote-repository.port";
import { quoteFileName } from "../../modules/quotes/application/quote-document";
import type { ChangeQuoteStatusUseCase } from "../../modules/quotes/application/use-cases/change-quote-status.use-case";
import type { CreateQuoteVersionUseCase } from "../../modules/quotes/application/use-cases/create-quote-version.use-case";
import type { CreateQuoteUseCase } from "../../modules/quotes/application/use-cases/create-quote.use-case";
import type { ListQuotesUseCase } from "../../modules/quotes/application/use-cases/list-quotes.use-case";
import type { QuoteTermsInput } from "../../modules/quotes/domain/quote-terms";
import type { SessionGateway } from "../../shared/application/ports";
import { checkPackageAccess } from "../packages/package-access";
import { checkQuoteAccess } from "./quote-access";

const CORRELATION_ID_HEADER = "x-correlation-id";

export type QuoteControllerDependencies = {
  readonly sessionGateway: Pick<SessionGateway, "currentUser">;
  readonly authorizePackageAccess: Pick<AuthorizePackageAccessUseCase, "execute">;
  readonly quoteReader: Pick<QuoteReader, "getQuote">;
  readonly listQuotes: Pick<ListQuotesUseCase, "execute">;
  readonly createQuote: Pick<CreateQuoteUseCase, "execute">;
  readonly createQuoteVersion: Pick<CreateQuoteVersionUseCase, "execute">;
  readonly changeQuoteStatus: Pick<ChangeQuoteStatusUseCase, "execute">;
  readonly pdfRenderer: QuotePdfRenderer;
  readonly defaultHeaders?: Record<string, string>;
};

/** Reads `x-correlation-id` from the request or generates one (DECOR-31). */
function correlationIdFor(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER);
  return provided && provided.trim().length > 0 ? provided.trim() : randomUUID();
}

/** Estado HTTP de los errores de cotización; el detalle de un 500 nunca se filtra. */
export function quoteErrorStatus(code: string): number {
  if (code === "auth.unauthenticated") return 401;
  if (code === "quote.not_found" || code === "package.not_found") return 404;
  if (code === "quote.package_version_conflict" || code === "quote.snapshot_mismatch") return 409;
  if (code === "quote.persistence_error" || code === "internal_error" || code.endsWith(".persistence_error")) {
    return 500;
  }
  if (code === "quote.invalid_body") return 400;
  if (code.startsWith("quote.") || code.startsWith("package.")) return 422;
  return 400;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/**
 * Solo se leen los términos que define el usuario. Cualquier subtotal, total
 * o precio enviado en el cuerpo se ignora: el servidor los calcula siempre.
 */
function readTerms(body: Record<string, unknown>): QuoteTermsInput {
  return {
    clientName: body.clientName,
    conditions: body.conditions,
    depositRateBp: body.depositRateBp,
    discountRateBp: body.discountRateBp,
    taxRateBp: body.taxRateBp,
    validUntil: body.validUntil,
  };
}

/**
 * HTTP boundary for versioned quotes (DECOR-50). Ownership is checked here
 * (package access before quoting, quote access before every quote operation)
 * and again inside the service-role RPC. A foreign or missing resource is
 * always reported as 404, indistinguishable from one that does not exist.
 */
export class QuoteController {
  private readonly defaultHeaders: Record<string, string>;

  constructor(private readonly deps: QuoteControllerDependencies) {
    this.defaultHeaders = deps.defaultHeaders ?? {};
  }

  private headers(correlationId: string): Record<string, string> {
    return { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };
  }

  private errorResponse(correlationId: string, code: string, message: string, logLabel: string): Response {
    const status = quoteErrorStatus(code);
    const headers = this.headers(correlationId);

    if (status === 500) {
      console.error(`[QuoteController.${logLabel}] (${correlationId}):`, code, message);
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

  private invalidBody(correlationId: string, logLabel: string): Response {
    return this.errorResponse(correlationId, "quote.invalid_body", "Se requiere un objeto JSON.", logLabel);
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

  /** `POST /api/packages/{packageId}/quotes`: versión 1 de una cotización nueva. */
  async handleCreate(request: Request, packageId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await checkPackageAccess(
        this.deps.authorizePackageAccess,
        packageId,
        this.headers(correlationId),
      );
      if (!access.ok) return access.response;

      const body = await readJsonBody(request);
      if (!body) return this.invalidBody(correlationId, "create");

      const result = await this.deps.createQuote.execute({
        ownerId: access.user.id,
        packageId,
        terms: readTerms(body),
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "create");
      }

      return Response.json(result.value, { headers: this.headers(correlationId), status: 201 });
    } catch (cause) {
      console.error(`[QuoteController.create] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }

  /** `GET /api/quotes`: cotizaciones del dueño. */
  async handleList(request: Request): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const user = await this.deps.sessionGateway.currentUser();
      if (!user) {
        return this.errorResponse(correlationId, "auth.unauthenticated", "Inicia sesión para continuar.", "list");
      }

      const result = await this.deps.listQuotes.execute(user.id);
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "list");
      }

      return Response.json({ quotes: result.value }, { headers: this.headers(correlationId) });
    } catch (cause) {
      console.error(`[QuoteController.list] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }

  /** `GET /api/quotes/{quoteId}`: una versión con sus líneas. */
  async handleGet(request: Request, quoteId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, quoteId);
      if (!access.ok) return access.response;

      return Response.json(access.quote, { headers: this.headers(correlationId) });
    } catch (cause) {
      console.error(`[QuoteController.get] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }

  /**
   * `GET /api/quotes/{quoteId}/pdf` (DECOR-52): PDF de la versión guardada.
   * Misma verificación que `handleGet` (401 sin sesión, 404 si es ajena o no
   * existe); el contenido sale sólo del `QuoteDto` congelado.
   */
  async handleGetPdf(request: Request, quoteId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, quoteId);
      if (!access.ok) return access.response;

      const pdf = await this.deps.pdfRenderer.render(access.quote);

      return new Response(pdf as BodyInit, {
        headers: {
          ...this.headers(correlationId),
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="${quoteFileName(access.quote)}"`,
          "content-length": String(pdf.byteLength),
          "content-type": "application/pdf",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (cause) {
      console.error(`[QuoteController.getPdf] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }

  /** `POST /api/quotes/{quoteId}/versions`: versión nueva del mismo número. */
  async handleCreateVersion(request: Request, quoteId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, quoteId);
      if (!access.ok) return access.response;

      const body = await readJsonBody(request);
      if (!body) return this.invalidBody(correlationId, "createVersion");

      const result = await this.deps.createQuoteVersion.execute({
        ownerId: access.user.id,
        quote: access.quote,
        terms: readTerms(body),
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "createVersion");
      }

      return Response.json(result.value, { headers: this.headers(correlationId), status: 201 });
    } catch (cause) {
      console.error(`[QuoteController.createVersion] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }

  /** `PATCH /api/quotes/{quoteId}/status`: borrador → enviada → aceptada, o → vencida. */
  async handleChangeStatus(request: Request, quoteId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, quoteId);
      if (!access.ok) return access.response;

      const body = await readJsonBody(request);
      if (!body) return this.invalidBody(correlationId, "changeStatus");

      const result = await this.deps.changeQuoteStatus.execute({
        ownerId: access.user.id,
        quote: access.quote,
        status: body.status,
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "changeStatus");
      }

      return Response.json(result.value, { headers: this.headers(correlationId) });
    } catch (cause) {
      console.error(`[QuoteController.changeStatus] Error inesperado (${correlationId}):`, cause);
      return this.internalError(correlationId);
    }
  }
}
