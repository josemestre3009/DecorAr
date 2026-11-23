import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { BASIS_POINTS_100, type QuoteTerms } from "./quote";

/** Límite de las condiciones comerciales, alineado con la CHECK de `quotes`. */
export const MAX_CONDITIONS_LENGTH = 2000;
/** Mismo límite que `packages.client_name`. */
export const MAX_QUOTE_CLIENT_NAME_LENGTH = 120;

/** Entrada sin validar, tal como llega del cuerpo HTTP. */
export interface QuoteTermsInput {
  readonly validUntil?: unknown;
  readonly discountRateBp?: unknown;
  readonly taxRateBp?: unknown;
  readonly depositRateBp?: unknown;
  readonly conditions?: unknown;
  readonly clientName?: unknown;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha ISO real (`2026-02-30` se rechaza). */
export function isIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizarTasa(
  value: unknown,
  code: string,
  label: string,
  required: boolean,
): Result<number, DomainError> {
  if (value === undefined || value === null) {
    return required
      ? err(new DomainError(code, `${label} es obligatorio.`))
      : ok(0);
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > BASIS_POINTS_100
  ) {
    return err(
      new DomainError(
        code,
        `${label} debe ser un entero en puntos básicos entre 0 y ${BASIS_POINTS_100} (0 % a 100 %).`,
      ),
    );
  }

  return ok(value);
}

function normalizarTextoOpcional(
  value: unknown,
  code: string,
  label: string,
  maxLength: number,
): Result<string | null, DomainError> {
  if (value === undefined || value === null) return ok(null);
  if (typeof value !== "string") return err(new DomainError(code, `${label} no es válido.`));

  const text = value.trim();
  if (text.length === 0) return ok(null);
  if (text.length > maxLength) {
    return err(new DomainError(code, `${label} no puede superar ${maxLength} caracteres.`));
  }

  return ok(text);
}

/**
 * Valida los términos comerciales de una versión de cotización (DECOR-50).
 *
 * - `validUntil` es obligatoria, ISO `YYYY-MM-DD` y no anterior a `today`.
 * - `taxRateBp` es obligatorio (el impuesto nunca se asume en silencio);
 *   `discountRateBp` y `depositRateBp` valen 0 si se omiten.
 * - `conditions` y `clientName` son textos opcionales recortados.
 */
export function validarTerminosCotizacion(
  input: QuoteTermsInput,
  today: string,
): Result<QuoteTerms, DomainError> {
  const validUntil = typeof input.validUntil === "string" ? input.validUntil.trim() : "";
  if (!isIsoDate(validUntil)) {
    return err(
      new DomainError("quote.invalid_valid_until", "La vigencia debe ser una fecha válida (AAAA-MM-DD)."),
    );
  }
  if (validUntil < today) {
    return err(
      new DomainError("quote.invalid_valid_until", "La vigencia no puede ser una fecha pasada."),
    );
  }

  const discount = normalizarTasa(input.discountRateBp, "quote.invalid_discount", "El descuento", false);
  if (!discount.ok) return discount;

  const tax = normalizarTasa(input.taxRateBp, "quote.invalid_tax", "El impuesto", true);
  if (!tax.ok) return tax;

  const deposit = normalizarTasa(input.depositRateBp, "quote.invalid_deposit", "El anticipo", false);
  if (!deposit.ok) return deposit;

  const conditions = normalizarTextoOpcional(
    input.conditions,
    "quote.invalid_conditions",
    "Las condiciones",
    MAX_CONDITIONS_LENGTH,
  );
  if (!conditions.ok) return conditions;

  const clientName = normalizarTextoOpcional(
    input.clientName,
    "quote.invalid_client_name",
    "El nombre del cliente",
    MAX_QUOTE_CLIENT_NAME_LENGTH,
  );
  if (!clientName.ok) return clientName;

  return ok({
    clientName: clientName.value,
    conditions: conditions.value,
    depositRateBp: deposit.value,
    discountRateBp: discount.value,
    taxRateBp: tax.value,
    validUntil,
  });
}
