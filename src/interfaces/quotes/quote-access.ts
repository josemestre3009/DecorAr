import type { QuoteDto } from "../../modules/quotes/application/dtos/quote.dto";
import type { QuoteReader } from "../../modules/quotes/application/ports/quote-repository.port";
import type { SessionUser } from "../../shared/domain/session";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type QuoteAccess =
  | { readonly ok: true; readonly user: SessionUser; readonly quote: QuoteDto }
  | { readonly ok: false; readonly response: Response };

export type QuoteAccessDependencies = {
  readonly currentUser: () => Promise<SessionUser | null>;
  readonly reader: Pick<QuoteReader, "getQuote">;
};

/**
 * HTTP adapter for quote ownership (DECOR-50). A quote Route Handler calls it
 * first and returns `response` untouched when access is denied: 401 without a
 * valid session, 404 for a missing, malformed or foreign quote
 * (indistinguishable). It also returns the quote it looked up, so `GET` does
 * not read it twice.
 */
export async function checkQuoteAccess(
  deps: QuoteAccessDependencies,
  quoteId: string,
  headers: Record<string, string> = {},
): Promise<QuoteAccess> {
  let user: SessionUser | null;
  try {
    user = await deps.currentUser();
  } catch (cause) {
    console.error("[quote-access] session lookup failed", cause);
    return { ok: false, response: internalError(headers) };
  }

  if (!user) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "auth.unauthenticated", message: "Inicia sesión para continuar." } },
        { headers, status: 401 },
      ),
    };
  }

  if (!UUID.test(quoteId)) {
    return { ok: false, response: notFound(headers) };
  }

  let found;
  try {
    found = await deps.reader.getQuote(quoteId, user.id);
  } catch (cause) {
    console.error("[quote-access] ownership lookup failed", cause);
    return { ok: false, response: internalError(headers) };
  }

  if (!found.ok) {
    console.error("[quote-access] ownership lookup failed", found.error);
    return { ok: false, response: internalError(headers) };
  }

  if (!found.value) {
    return { ok: false, response: notFound(headers) };
  }

  return { ok: true, quote: found.value, user };
}

function notFound(headers: Record<string, string>): Response {
  return Response.json(
    { error: { code: "quote.not_found", message: "No encontramos esta cotización." } },
    { headers, status: 404 },
  );
}

function internalError(headers: Record<string, string>): Response {
  return Response.json(
    { error: { code: "internal_error", message: "No pudimos completar la operación." } },
    { headers, status: 500 },
  );
}
