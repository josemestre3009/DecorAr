import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { CreatedQuoteResultDto, QuoteDto } from "../application/dtos/quote.dto";
import type {
  ChangeQuoteStatusParams,
  CreateQuoteParams,
  CreateQuoteVersionParams,
  QuoteRepository,
} from "../application/ports/quote-repository.port";
import type { QuoteTerms } from "../domain/quote";
import { isQuoteStatus } from "../domain/quote-status";
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
  "quote.version_conflict",
  "quote.status_conflict",
  "idempotency.key_invalid",
  "idempotency.key_reused",
]);

/** Mensajes para el usuario de los códigos de DECOR-55 (el resto conserva el código como mensaje). */
const USER_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["quote.version_conflict", "La cotización cambió mientras la editabas: ya hay una versión más nueva. Recarga para verla."],
  ["quote.status_conflict", "La cotización cambió de estado mientras la revisabas. Recarga para ver el estado actual."],
  ["idempotency.key_invalid", "La cabecera Idempotency-Key es obligatoria y debe ser un UUID."],
  ["idempotency.key_reused", "Esta clave de idempotencia ya se usó para otra solicitud."],
]);

type RpcError = { readonly code?: string; readonly details?: string | null; readonly message: string };
type RpcQuoteRow = QuoteRow & { readonly replayed?: unknown };

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

/** Datos del conflicto que el RPC envía en `DETAIL` (DECOR-55). */
function conflictMetadata(code: string, details: string | null | undefined): Record<string, unknown> {
  if (code === "quote.version_conflict") {
    const currentVersion = Number(details);
    return Number.isSafeInteger(currentVersion) && currentVersion >= 1 ? { currentVersion } : {};
  }
  if (code === "quote.status_conflict" && isQuoteStatus(details)) {
    return { currentStatus: details };
  }
  return {};
}

/**
 * Un error desconocido de Postgres se conserva sólo como `cause` (DECOR-55):
 * el mensaje de un `DomainError` puede llegar a un log o a la respuesta y el
 * texto crudo de Postgres puede contener valores de la fila.
 */
function toDomainError(fn: string, error: RpcError): DomainError {
  if (KNOWN_CODES.has(error.message)) {
    return new DomainError(
      error.message,
      USER_MESSAGES.get(error.message) ?? error.message,
      { cause: error },
      conflictMetadata(error.message, error.details),
    );
  }
  return new DomainError("quote.persistence_error", `Error en ${fn}`, { cause: error });
}

/**
 * Escrituras atómicas de cotizaciones (DECOR-50). Se construye con el cliente
 * service_role: los RPC son `SECURITY INVOKER`, no conceden escritura a
 * anon/authenticated y vuelven a comprobar el dueño dentro de la transacción.
 */
export class SupabaseQuoteRepository implements QuoteRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async call(fn: string, args: Record<string, unknown>): Promise<Result<RpcQuoteRow, DomainError>> {
    try {
      const { data, error } = await this.client.rpc(fn, args);

      if (error) return err(toDomainError(fn, error));

      if (!data) {
        return err(new DomainError("quote.persistence_error", `RPC ${fn} returned no data`));
      }

      return ok(data as RpcQuoteRow);
    } catch (cause) {
      return err(new DomainError("quote.persistence_error", `Error en ${fn}`, { cause }));
    }
  }

  private async callCreated(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<Result<CreatedQuoteResultDto, DomainError>> {
    const row = await this.call(fn, args);
    if (!row.ok) return row;
    return ok({ quote: mapQuoteRow(row.value), replayed: row.value.replayed === true });
  }

  create(params: CreateQuoteParams): Promise<Result<CreatedQuoteResultDto, DomainError>> {
    return this.callCreated("create_quote", {
      p_expected_package_version: params.expectedPackageVersion,
      p_idempotency_key: params.idempotencyKey,
      p_owner_id: params.ownerId,
      p_package_id: params.packageId,
      p_request_fingerprint: params.requestFingerprint,
      ...versionArgs(params.terms, params.calculation),
    });
  }

  createVersion(params: CreateQuoteVersionParams): Promise<Result<CreatedQuoteResultDto, DomainError>> {
    return this.callCreated("create_quote_version", {
      p_expected_package_version: params.expectedPackageVersion,
      p_expected_version: params.expectedVersion,
      p_idempotency_key: params.idempotencyKey,
      p_owner_id: params.ownerId,
      p_quote_id: params.quoteId,
      p_request_fingerprint: params.requestFingerprint,
      ...versionArgs(params.terms, params.calculation),
    });
  }

  async changeStatus(params: ChangeQuoteStatusParams): Promise<Result<QuoteDto, DomainError>> {
    const row = await this.call("change_quote_status", {
      p_expected_status: params.expectedStatus,
      p_owner_id: params.ownerId,
      p_quote_id: params.quoteId,
      p_status: params.status,
    });
    return row.ok ? ok(mapQuoteRow(row.value)) : row;
  }
}
