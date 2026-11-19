import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { QuoteDto, QuoteSummaryDto } from "../application/dtos/quote.dto";
import type { QuoteReader } from "../application/ports/quote-repository.port";
import {
  mapQuoteRow,
  mapQuoteSummaryRow,
  QUOTE_COLUMNS,
  QUOTE_SUMMARY_COLUMNS,
  type QuoteRow,
  type QuoteSummaryRow,
} from "./quote-row";

/** Postgres `invalid_text_representation`: a malformed uuid reached the query. */
const INVALID_TEXT_REPRESENTATION = "22P02";

const persistenceError = (message: string, cause: unknown) =>
  err(new DomainError("quote.persistence_error", message, { cause }));

/**
 * Lecturas de cotizaciones (DECOR-50). Se construye con el cliente de sesión,
 * así que RLS filtra por dueño; además se filtra explícitamente por
 * `owner_id`, de modo que una cotización ajena o inexistente devuelve `null`.
 */
export class SupabaseQuoteReader implements QuoteReader {
  constructor(private readonly client: SupabaseClient) {}

  async getQuote(quoteId: string, ownerId: string): Promise<Result<QuoteDto | null, DomainError>> {
    try {
      const { data, error } = await this.client
        .from("quotes")
        .select(QUOTE_COLUMNS)
        .eq("id", quoteId)
        .eq("owner_id", ownerId)
        .maybeSingle();

      if (error) {
        if (error.code === INVALID_TEXT_REPRESENTATION) return ok(null);
        return persistenceError(error.message, error);
      }

      return ok(data ? mapQuoteRow(data as QuoteRow) : null);
    } catch (cause) {
      return persistenceError(cause instanceof Error ? cause.message : "Error al consultar la cotización", cause);
    }
  }

  async listQuotes(ownerId: string): Promise<Result<QuoteSummaryDto[], DomainError>> {
    try {
      const { data, error } = await this.client
        .from("quotes")
        .select(QUOTE_SUMMARY_COLUMNS)
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });

      if (error) return persistenceError(error.message, error);

      return ok(((data as QuoteSummaryRow[] | null) ?? []).map(mapQuoteSummaryRow));
    } catch (cause) {
      return persistenceError(cause instanceof Error ? cause.message : "Error al consultar las cotizaciones", cause);
    }
  }
}
