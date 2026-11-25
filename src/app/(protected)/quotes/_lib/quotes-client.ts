import { isQuoteStatus, type QuoteStatus } from "@/modules/quotes/domain/quote-status";
import { err, ok, type Result } from "@/shared/domain/result";

import {
  networkFailure,
  readApiError,
  unexpectedResponseFailure,
  type ApiFailure,
} from "../../packages/_lib/api-error";

/**
 * Puerto de la interfaz hacia la API de cotizaciones (DECOR-50):
 *
 * - `POST /api/packages/{packageId}/quotes` → 201 `QuoteDto` (versión 1)
 * - `POST /api/quotes/{quoteId}/versions` → 201 `QuoteDto` (versión nueva)
 * - `PATCH /api/quotes/{quoteId}/status {status}` → 200 (DECOR-49: marcar como enviada)
 * - `GET /api/quotes` → 200 `{quotes: QuoteSummaryDto[]}` (DECOR-49: cotizaciones del evento)
 * - errores `{error:{code,message}}` con 400/401/404/409/422
 *
 * Solo se envían los términos: el servidor congela precios y calcula totales.
 *
 * DECOR-55: los dos POST exigen `Idempotency-Key` (UUID), la versión nueva
 * envía `expectedVersion` y el cambio de estado `expectedStatus`; un 409 de
 * concurrencia se muestra como "la cotización cambió, recarga".
 */

/** Términos comerciales que acepta la API; tasas en puntos básicos (1 % = 100). */
export type QuoteTermsRequest = {
  readonly validUntil: string;
  readonly taxRateBp: number;
  readonly discountRateBp: number;
  readonly depositRateBp: number;
  readonly conditions: string | null;
  readonly clientName: string | null;
};

/** Lo que la interfaz necesita de la respuesta: el id para navegar a la vista previa. */
export type CreatedQuote = { readonly id: string; readonly version: number };

/** Enlace público de una cotización (DECOR-53), tal como lo expone la API. */
export type QuoteShareLink = {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
};

/** Fila de `GET /api/quotes` que usa la interfaz (DECOR-49). */
export type QuoteListItem = {
  readonly id: string;
  readonly number: number;
  readonly version: number;
  readonly status: QuoteStatus;
  readonly packageId: string | null;
  readonly totalCop: number;
  readonly validUntil: string;
  readonly createdAt: string;
};

/**
 * Una intención de crear (DECOR-55): la misma `idempotencyKey` se reenvía en
 * cada reintento, así un doble clic o un reintento tras un corte de red no
 * crea otra cotización ni otra versión.
 */
export type CreateIntent = { readonly idempotencyKey: string };

export type QuotesClient = {
  createQuote(
    packageId: string,
    terms: QuoteTermsRequest,
    intent: CreateIntent,
  ): Promise<Result<CreatedQuote, ApiFailure>>;
  /** `expectedVersion`: la última versión que vio el usuario; si hay otra más nueva, 409. */
  createQuoteVersion(
    quoteId: string,
    terms: QuoteTermsRequest,
    intent: CreateIntent & { readonly expectedVersion: number },
  ): Promise<Result<CreatedQuote, ApiFailure>>;
  getShareLink(quoteId: string): Promise<Result<QuoteShareLink | null, ApiFailure>>;
  createShareLink(quoteId: string): Promise<Result<QuoteShareLink, ApiFailure>>;
  revokeShareLink(quoteId: string): Promise<Result<void, ApiFailure>>;
  /** `PATCH /api/quotes/{id}/status` (DECOR-50); la transición la valida el servidor. */
  changeStatus(
    quoteId: string,
    status: QuoteStatus,
    expectedStatus: QuoteStatus,
  ): Promise<Result<void, ApiFailure>>;
  /** `GET /api/quotes`: cotizaciones del dueño, de la más reciente a la más antigua. */
  listQuotes(signal?: AbortSignal): Promise<Result<QuoteListItem[], ApiFailure>>;
};

function isCreatedQuote(value: unknown): value is CreatedQuote {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "version" in value &&
    typeof value.version === "number"
  );
}

async function postTerms(
  fetcher: typeof fetch,
  url: string,
  request: QuoteTermsRequest & { readonly expectedVersion?: number },
  idempotencyKey: string,
): Promise<Result<CreatedQuote, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(url, {
      body: JSON.stringify(request),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    });
  } catch {
    return err(networkFailure());
  }

  if (response.status !== 201) {
    return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return err(unexpectedResponseFailure(response.status));
  }

  return isCreatedQuote(body) ? ok({ id: body.id, version: body.version }) : err(unexpectedResponseFailure(201));
}

function isQuoteShareLink(value: unknown): value is QuoteShareLink {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "url" in value &&
    typeof value.url === "string" &&
    "expiresAt" in value &&
    typeof value.expiresAt === "string"
  );
}

function shareLinkUrl(quoteId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/share-link`;
}

async function readJsonBody(response: Response): Promise<Result<unknown, ApiFailure>> {
  try {
    return ok(await response.json());
  } catch {
    return err(unexpectedResponseFailure(response.status));
  }
}

async function getShareLink(
  fetcher: typeof fetch,
  quoteId: string,
): Promise<Result<QuoteShareLink | null, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(shareLinkUrl(quoteId), { headers: { Accept: "application/json" } });
  } catch {
    return err(networkFailure());
  }

  if (!response.ok) return err(await readApiError(response));

  const body = await readJsonBody(response);
  if (!body.ok) return body;

  const { link } = body.value as { link?: unknown };
  if (link === null || link === undefined) return ok(null);

  return isQuoteShareLink(link) ? ok(link) : err(unexpectedResponseFailure(response.status));
}

async function createShareLink(
  fetcher: typeof fetch,
  quoteId: string,
): Promise<Result<QuoteShareLink, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(shareLinkUrl(quoteId), { method: "POST" });
  } catch {
    return err(networkFailure());
  }

  if (response.status !== 201) {
    return err(response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response));
  }

  const body = await readJsonBody(response);
  if (!body.ok) return body;

  return isQuoteShareLink(body.value) ? ok(body.value) : err(unexpectedResponseFailure(201));
}

async function revokeShareLink(fetcher: typeof fetch, quoteId: string): Promise<Result<void, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(shareLinkUrl(quoteId), { method: "DELETE" });
  } catch {
    return err(networkFailure());
  }

  if (!response.ok) return err(await readApiError(response));

  return ok(undefined);
}

async function changeStatus(
  fetcher: typeof fetch,
  quoteId: string,
  status: QuoteStatus,
  expectedStatus: QuoteStatus,
): Promise<Result<void, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(`/api/quotes/${encodeURIComponent(quoteId)}/status`, {
      body: JSON.stringify({ expectedStatus, status }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "PATCH",
    });
  } catch {
    return err(networkFailure());
  }

  if (!response.ok) return err(await readApiError(response));

  return ok(undefined);
}

function isQuoteListItem(value: unknown): value is QuoteListItem {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;

  return (
    typeof row.id === "string" &&
    typeof row.number === "number" &&
    typeof row.version === "number" &&
    isQuoteStatus(row.status) &&
    (typeof row.packageId === "string" || row.packageId === null) &&
    typeof row.totalCop === "number" &&
    typeof row.validUntil === "string" &&
    typeof row.createdAt === "string"
  );
}

async function listQuotes(
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<Result<QuoteListItem[], ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher("/api/quotes", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return err(networkFailure());
  }

  if (!response.ok) return err(await readApiError(response));

  const body = await readJsonBody(response);
  if (!body.ok) return body;

  const { quotes } = (body.value ?? {}) as { quotes?: unknown };
  if (!Array.isArray(quotes) || !quotes.every(isQuoteListItem)) {
    return err(unexpectedResponseFailure(response.status));
  }

  return ok(
    quotes.map(({ id, number, version, status, packageId, totalCop, validUntil, createdAt }) => ({
      createdAt,
      id,
      number,
      packageId,
      status,
      totalCop,
      validUntil,
      version,
    })),
  );
}

export function createHttpQuotesClient(fetcher: typeof fetch = fetch): QuotesClient {
  return {
    changeStatus: (quoteId, status, expectedStatus) => changeStatus(fetcher, quoteId, status, expectedStatus),
    listQuotes: (signal) => listQuotes(fetcher, signal),
    createQuote: (packageId, terms, intent) =>
      postTerms(fetcher, `/api/packages/${encodeURIComponent(packageId)}/quotes`, terms, intent.idempotencyKey),
    createQuoteVersion: (quoteId, terms, intent) =>
      postTerms(
        fetcher,
        `/api/quotes/${encodeURIComponent(quoteId)}/versions`,
        { ...terms, expectedVersion: intent.expectedVersion },
        intent.idempotencyKey,
      ),
    createShareLink: (quoteId) => createShareLink(fetcher, quoteId),
    getShareLink: (quoteId) => getShareLink(fetcher, quoteId),
    revokeShareLink: (quoteId) => revokeShareLink(fetcher, quoteId),
  };
}
