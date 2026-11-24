import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { PublicQuoteDto, QuoteLineDto, QuoteShareLinkDto } from "../application/dtos/quote.dto";
import type {
  CreateQuoteShareLinkParams,
  OwnedQuoteShareLinkParams,
  QuoteShareLinkRepository,
  SharedQuoteReader,
} from "../application/ports/quote-share-link-repository.port";
import { mapQuoteRow, type QuoteRow } from "./quote-row";
import { mapQuoteShareLinkRow, type QuoteShareLinkRow } from "./quote-share-link-row";

/** Códigos que las RPC de enlace compartido emiten de forma estable. */
const KNOWN_CODES = new Set([
  "auth.unauthenticated",
  "quote.not_found",
  "quote.share_not_allowed",
  "quote.share_expiry_too_far",
  "quote.share_link_not_found",
  "quote.invalid_body",
]);

function toHex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

function errorOf(fn: string, error: { message: string }): DomainError {
  if (KNOWN_CODES.has(error.message)) {
    return new DomainError(error.message, error.message, { cause: error });
  }
  return new DomainError("quote.persistence_error", error.message || `Error en ${fn}`, { cause: error });
}

/**
 * Escrituras y lecturas de dueño del enlace público (DECOR-53). Se construye
 * con el cliente `service_role`: las RPC no conceden ejecución a
 * anon/authenticated y vuelven a comprobar el dueño dentro de la transacción.
 */
export class SupabaseQuoteShareLinkRepository implements QuoteShareLinkRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(params: CreateQuoteShareLinkParams): Promise<Result<QuoteShareLinkDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("create_quote_share_link", {
        p_expires_at: params.expiresAt.toISOString(),
        p_link_id: params.linkId,
        p_owner_id: params.ownerId,
        p_quote_id: params.quoteId,
        p_token_hash: toHex(params.tokenHash),
      });

      if (error) return err(errorOf("create_quote_share_link", error));
      if (!data) return err(new DomainError("quote.persistence_error", "RPC create_quote_share_link returned no data"));

      return ok(mapQuoteShareLinkRow(data as QuoteShareLinkRow));
    } catch (cause) {
      return err(
        new DomainError(
          "quote.persistence_error",
          cause instanceof Error ? cause.message : "Error en create_quote_share_link",
          { cause },
        ),
      );
    }
  }

  async getActive(params: OwnedQuoteShareLinkParams): Promise<Result<QuoteShareLinkDto | null, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("get_quote_share_link", {
        p_owner_id: params.ownerId,
        p_quote_id: params.quoteId,
      });

      if (error) return err(errorOf("get_quote_share_link", error));

      return ok(data ? mapQuoteShareLinkRow(data as QuoteShareLinkRow) : null);
    } catch (cause) {
      return err(
        new DomainError(
          "quote.persistence_error",
          cause instanceof Error ? cause.message : "Error en get_quote_share_link",
          { cause },
        ),
      );
    }
  }

  async revoke(params: OwnedQuoteShareLinkParams): Promise<Result<QuoteShareLinkDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("revoke_quote_share_link", {
        p_owner_id: params.ownerId,
        p_quote_id: params.quoteId,
      });

      if (error) return err(errorOf("revoke_quote_share_link", error));
      if (!data) return err(new DomainError("quote.persistence_error", "RPC revoke_quote_share_link returned no data"));

      return ok(mapQuoteShareLinkRow(data as QuoteShareLinkRow));
    } catch (cause) {
      return err(
        new DomainError(
          "quote.persistence_error",
          cause instanceof Error ? cause.message : "Error en revoke_quote_share_link",
          { cause },
        ),
      );
    }
  }
}

/**
 * Lectura pública de una cotización compartida (DECOR-53). `anon` no tiene
 * permisos sobre `quotes` ni `quote_share_links`: esta clase siempre se
 * construye con el cliente `service_role` en el servidor.
 */
export class SupabaseSharedQuoteReader implements SharedQuoteReader {
  constructor(private readonly client: SupabaseClient) {}

  async getSharedQuote(tokenHash: Uint8Array): Promise<Result<PublicQuoteDto | null, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("get_shared_quote", {
        p_token_hash: toHex(tokenHash),
      });

      if (error) return err(errorOf("get_shared_quote", error));
      if (!data) return ok(null);

      return ok(toPublicQuoteDto(mapQuoteRow(data as QuoteRow)));
    } catch (cause) {
      return err(
        new DomainError(
          "quote.persistence_error",
          cause instanceof Error ? cause.message : "Error en get_shared_quote",
          { cause },
        ),
      );
    }
  }
}

/** Línea sin `moduleId`: es un identificador interno, no algo que ver sin sesión. */
function withoutModuleId(line: QuoteLineDto): Omit<QuoteLineDto, "moduleId"> {
  return { lineTotalCop: line.lineTotalCop, name: line.name, position: line.position, quantity: line.quantity, unitPriceCop: line.unitPriceCop };
}

/** Reduce el `QuoteDto` completo a lo que un visitante sin sesión puede ver. */
function toPublicQuoteDto(quote: ReturnType<typeof mapQuoteRow>): PublicQuoteDto {
  return {
    client: quote.client,
    conditions: quote.conditions,
    currency: quote.currency,
    event: quote.event,
    lines: quote.lines.map(withoutModuleId),
    number: quote.number,
    terms: quote.terms,
    totals: quote.totals,
    validUntil: quote.validUntil,
    version: quote.version,
  };
}
