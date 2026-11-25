import { randomUUID } from "node:crypto";

import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { CreatedQuoteResultDto } from "../../modules/quotes/application/dtos/quote.dto";
import type { QuotePdfRenderer } from "../../modules/quotes/application/ports/quote-pdf-renderer.port";
import type { QuoteReader } from "../../modules/quotes/application/ports/quote-repository.port";
import { quoteFileName } from "../../modules/quotes/application/quote-document";
import type { ChangeQuoteStatusUseCase } from "../../modules/quotes/application/use-cases/change-quote-status.use-case";
import type { CreateQuoteVersionUseCase } from "../../modules/quotes/application/use-cases/create-quote-version.use-case";
import type { CreateQuoteUseCase } from "../../modules/quotes/application/use-cases/create-quote.use-case";
import type { ListQuotesUseCase } from "../../modules/quotes/application/use-cases/list-quotes.use-case";
import type { QuoteTermsInput } from "../../modules/quotes/domain/quote-terms";
import type { Logger, SessionGateway } from "../../shared/application/ports";
import { checkPackageAccess } from "../packages/package-access";
import { checkQuoteAccess } from "./quote-access";

const CORRELATION_ID_HEADER = "x-correlation-id";
/** DECOR-55: obligatoria en los POST que crean una cotización o una versión. */
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const IDEMPOTENT_REPLAYED_HEADER = "idempotent-replayed";

export type QuoteControllerDependencies = {
  readonly sessionGateway: Pick<SessionGateway, "currentUser">;
  readonly authorizePackageAccess: Pick<AuthorizePackageAccessUseCase, "execute">;
  readonly quoteReader: Pick<QuoteReader, "getQuote">;
  readonly listQuotes: Pick<ListQuotesUseCase, "execute">;
  readonly createQuote: Pick<CreateQuoteUseCase, "execute">;
  readonly createQuoteVersion: Pick<CreateQuoteVersionUseCase, "execute">;
  readonly changeQuoteStatus: Pick<ChangeQuoteStatusUseCase, "execute">;
  readonly pdfRenderer: QuotePdfRenderer;
  readonly logger: Logger;
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
  if (
    code === "quote.package_version_conflict" ||
    code === "quote.snapshot_mismatch" ||
    code === "quote.version_conflict" ||
    code === "quote.status_conflict"
  ) {
    return 409;
  }
  if (code === "idempotency.key_invalid") return 400;
  if (code === "idempotency.key_reused") return 422;
  if (code === "quote.persistence_error" || code === "internal_error" || code.endsWith(".persistence_error")) {
    return 500;
  }
  if (code === "quote.invalid_body") return 400;
  if (code.startsWith("quote.") || code.startsWith("package.")) return 422;
  return 400;
}

type QuoteFailure = {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

function sqlState(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

function conflictDetails(error: QuoteFailure): Record<string, unknown> {
  const metadata = error.metadata ?? {};
  if (error.code === "quote.version_conflict" && typeof metadata.currentVersion === "number") {
    return { currentVersion: metadata.currentVersion };
  }
  if (error.code === "quote.status_conflict" && typeof metadata.currentStatus === "string") {
    return { currentStatus: metadata.currentStatus };
  }
  return {};
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

  /**
   * Un 409 de concurrencia (DECOR-55) incluye el valor actual que vio el RPC
   * (`currentVersion` o `currentStatus`) para que el cliente recargue en vez
   * de sobrescribir. Un 500 sólo se registra, con el `Logger` sanitizado.
   */
  private errorResponse(correlationId: string, error: QuoteFailure, logLabel: string): Response {
    const { code, message } = error;
    const status = quoteErrorStatus(code);
    const headers = this.headers(correlationId);

    if (status === 500) {
      // Sólo el SQLSTATE: `details` de Postgres puede traer valores de la fila.
      this.deps.logger.error("quote.request_failed", {
        code,
        dbCode: sqlState(error.cause),
        component: `QuoteController.${logLabel}`,
        correlationId,
      });
      return this.internalError(correlationId);
    }

    return Response.json({ error: { code, message }, ...conflictDetails(error) }, { headers, status });
  }

  private unexpected(logLabel: string, correlationId: string, cause: unknown): void {
    this.deps.logger.error("quote.unexpected_error", {
      component: `QuoteController.${logLabel}`,
      correlationId,
      error: cause,
    });
  }

  /**
   * Un reintento con la misma `Idempotency-Key` responde igual que el primer
   * intento (201 con la misma cotización) y lo marca con
   * `Idempotent-Replayed: true` (la misma convención que usa Stripe).
   */
  private created(correlationId: string, result: CreatedQuoteResultDto): Response {
    const headers = this.headers(correlationId);
    return Response.json(result.quote, {
      headers: result.replayed ? { ...headers, [IDEMPOTENT_REPLAYED_HEADER]: "true" } : headers,
      status: 201,
    });
  }

  private internalError(correlationId: string): Response {
    return Response.json(
      { error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { headers: this.headers(correlationId), status: 500 },
    );
  }

  private invalidBody(correlationId: string, logLabel: string): Response {
    return this.errorResponse(correlationId, { code: "quote.invalid_body", message: "Se requiere un objeto JSON." }, logLabel);
  }

  private access(correlationId: string, quoteId: string) {
    return checkQuoteAccess(
      {
        currentUser: () => this.deps.sessionGateway.currentUser(),
        logger: this.deps.logger,
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
        idempotencyKey: request.headers.get(IDEMPOTENCY_KEY_HEADER),
        ownerId: access.user.id,
        packageId,
        terms: readTerms(body),
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error, "create");
      }

      return this.created(correlationId, result.value);
    } catch (cause) {
      this.unexpected("create", correlationId, cause);
      return this.internalError(correlationId);
    }
  }

  /** `GET /api/quotes`: cotizaciones del dueño. */
  async handleList(request: Request): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const user = await this.deps.sessionGateway.currentUser();
      if (!user) {
        return this.errorResponse(correlationId, { code: "auth.unauthenticated", message: "Inicia sesión para continuar." }, "list");
      }

      const result = await this.deps.listQuotes.execute(user.id);
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error, "list");
      }

      return Response.json({ quotes: result.value }, { headers: this.headers(correlationId) });
    } catch (cause) {
      this.unexpected("list", correlationId, cause);
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
      this.unexpected("get", correlationId, cause);
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
      this.unexpected("getPdf", correlationId, cause);
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
        expectedVersion: body.expectedVersion,
        idempotencyKey: request.headers.get(IDEMPOTENCY_KEY_HEADER),
        ownerId: access.user.id,
        quote: access.quote,
        terms: readTerms(body),
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error, "createVersion");
      }

      return this.created(correlationId, result.value);
    } catch (cause) {
      this.unexpected("createVersion", correlationId, cause);
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
        expectedStatus: body.expectedStatus,
        ownerId: access.user.id,
        quote: access.quote,
        status: body.status,
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error, "changeStatus");
      }

      return Response.json(result.value, { headers: this.headers(correlationId) });
    } catch (cause) {
      this.unexpected("changeStatus", correlationId, cause);
      return this.internalError(correlationId);
    }
  }
}
