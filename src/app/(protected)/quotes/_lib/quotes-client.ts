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
 * - errores `{error:{code,message}}` con 400/401/404/409/422
 *
 * Solo se envían los términos: el servidor congela precios y calcula totales.
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

export type QuotesClient = {
  createQuote(packageId: string, terms: QuoteTermsRequest): Promise<Result<CreatedQuote, ApiFailure>>;
  createQuoteVersion(quoteId: string, terms: QuoteTermsRequest): Promise<Result<CreatedQuote, ApiFailure>>;
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
  terms: QuoteTermsRequest,
): Promise<Result<CreatedQuote, ApiFailure>> {
  let response: Response;

  try {
    response = await fetcher(url, {
      body: JSON.stringify(terms),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
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

export function createHttpQuotesClient(fetcher: typeof fetch = fetch): QuotesClient {
  return {
    createQuote: (packageId, terms) =>
      postTerms(fetcher, `/api/packages/${encodeURIComponent(packageId)}/quotes`, terms),
    createQuoteVersion: (quoteId, terms) =>
      postTerms(fetcher, `/api/quotes/${encodeURIComponent(quoteId)}/versions`, terms),
  };
}
