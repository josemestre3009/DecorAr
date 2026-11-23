import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { QuoteDto } from "../application/dtos/quote.dto";
import type {
  ChangeQuoteStatusParams,
  CreateQuoteParams,
  CreateQuoteVersionParams,
  QuoteRepository,
} from "../application/ports/quote-repository.port";
import type { QuoteTerms } from "../domain/quote";
import type { QuoteCalculation } from "../domain/quote-totals";
import { mapQuoteRow, type QuoteRow } from "./quote-row";

/** Códigos que los RPC de cotización emiten de forma estable. */
const KNOWN_CODES = new Set([
  "auth.unauthenticated",
  "package.not_found",
  "quote.not_found",
  "quote.package_missing",
  "quote.package_version_conflict",
  "quote.snapshot_mismatch",
  "quote.empty_package",
  "quote.invalid_totals",
  "quote.invalid_line",
  "quote.invalid_body",
  "quote.invalid_status",
  "quote.invalid_status_transition",
  "quote.immutable",
]);

/** Argumentos jsonb comunes de `create_quote` y `create_quote_version`. */
function versionArgs(terms: QuoteTerms, calculation: QuoteCalculation) {
  const { totals } = calculation;
  return {
    p_lines: calculation.lines.map((line) => ({
      lineTotalCop: line.lineTotalCop,
      moduleId: line.moduleId,
      name: line.name,
      position: line.position,
      quantity: line.quantity,
      unitPriceCop: line.unitPriceCop,
    })),
    p_quote: {
      clientName: terms.clientName,
      conditions: terms.conditions,
      depositCop: totals.depositCop,
      depositRateBp: terms.depositRateBp,
      discountCop: totals.discountCop,
      discountRateBp: terms.discountRateBp,
      subtotalCop: totals.subtotalCop,
      taxCop: totals.taxCop,
      taxRateBp: terms.taxRateBp,
      totalCop: totals.totalCop,
      validUntil: terms.validUntil,
    },
  };
}

/**
 * Escrituras atómicas de cotizaciones (DECOR-50). Se construye con el cliente
 * service_role: los RPC son `SECURITY INVOKER`, no conceden escritura a
 * anon/authenticated y vuelven a comprobar el dueño dentro de la transacción.
 */
export class SupabaseQuoteRepository implements QuoteRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async call(fn: string, args: Record<string, unknown>): Promise<Result<QuoteDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc(fn, args);

      if (error) {
        if (KNOWN_CODES.has(error.message)) {
          return err(new DomainError(error.message, error.message, { cause: error }));
        }
        return err(new DomainError("quote.persistence_error", error.message || `Error en ${fn}`, { cause: error }));
      }

      if (!data) {
        return err(new DomainError("quote.persistence_error", `RPC ${fn} returned no data`));
      }

      return ok(mapQuoteRow(data as QuoteRow));
    } catch (cause) {
      return err(
        new DomainError("quote.persistence_error", cause instanceof Error ? cause.message : `Error en ${fn}`, {
          cause,
        }),
      );
    }
  }

  create(params: CreateQuoteParams): Promise<Result<QuoteDto, DomainError>> {
    return this.call("create_quote", {
      p_expected_package_version: params.expectedPackageVersion,
      p_owner_id: params.ownerId,
      p_package_id: params.packageId,
      ...versionArgs(params.terms, params.calculation),
    });
  }

  createVersion(params: CreateQuoteVersionParams): Promise<Result<QuoteDto, DomainError>> {
    return this.call("create_quote_version", {
      p_expected_package_version: params.expectedPackageVersion,
      p_owner_id: params.ownerId,
      p_quote_id: params.quoteId,
      ...versionArgs(params.terms, params.calculation),
    });
  }

  changeStatus(params: ChangeQuoteStatusParams): Promise<Result<QuoteDto, DomainError>> {
    return this.call("change_quote_status", {
      p_owner_id: params.ownerId,
      p_quote_id: params.quoteId,
      p_status: params.status,
    });
  }
}
