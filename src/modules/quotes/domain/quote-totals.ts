import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import {
  BASIS_POINTS_100,
  type QuoteLine,
  type QuoteLineSnapshot,
  type QuoteTotals,
} from "./quote";

export type QuoteRates = {
  readonly discountRateBp: number;
  readonly taxRateBp: number;
  readonly depositRateBp: number;
};

export type QuoteCalculation = {
  readonly lines: readonly QuoteLine[];
  readonly totals: QuoteTotals;
};

const BP = BigInt(BASIS_POINTS_100);
const HALF_BP = BP / BigInt(2);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * `amount × rateBp / 10000` redondeado al peso más cercano, con la mitad hacia
 * arriba (redondeo COP). Usa BigInt para que el producto intermedio nunca
 * pierda precisión; solo opera sobre montos no negativos.
 */
export function applyRateCop(amountCop: bigint, rateBp: number): bigint {
  return (amountCop * BigInt(rateBp) + HALF_BP) / BP;
}

const isRate = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= BASIS_POINTS_100;

function invalidLine(message: string): Result<never, DomainError> {
  return err(new DomainError("quote.invalid_line", message));
}

function toSafeNumber(value: bigint): Result<number, DomainError> {
  if (value > MAX_SAFE) {
    return err(
      new DomainError("quote.total_overflow", "El total calculado excede el rango seguro de enteros."),
    );
  }
  return ok(Number(value));
}

/**
 * Calcula líneas y totales de una cotización (DECOR-50). Función pura: sin
 * Supabase ni I/O, se ejecuta siempre en servidor.
 *
 * Orden: subtotal = Σ cantidad × precio unitario; descuento sobre el subtotal;
 * impuesto sobre la base (subtotal − descuento); total = base + impuesto;
 * anticipo sobre el total. Cada monto derivado se redondea al peso entero.
 */
export function calculateQuote(
  snapshot: readonly QuoteLineSnapshot[],
  rates: QuoteRates,
): Result<QuoteCalculation, DomainError> {
  if (snapshot.length === 0) {
    return err(
      new DomainError("quote.empty_package", "El evento no tiene elementos para cotizar."),
    );
  }

  if (!isRate(rates.discountRateBp)) {
    return err(new DomainError("quote.invalid_discount", "El descuento debe estar entre 0 % y 100 %."));
  }
  if (!isRate(rates.taxRateBp)) {
    return err(new DomainError("quote.invalid_tax", "El impuesto debe estar entre 0 % y 100 %."));
  }
  if (!isRate(rates.depositRateBp)) {
    return err(new DomainError("quote.invalid_deposit", "El anticipo debe estar entre 0 % y 100 %."));
  }

  const lines: QuoteLine[] = [];
  let subtotal = BigInt(0);

  for (const [index, line] of snapshot.entries()) {
    if (typeof line.name !== "string" || line.name.trim().length === 0) {
      return invalidLine("Cada concepto necesita un nombre.");
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      return invalidLine(`La cantidad de "${line.name}" debe ser un entero positivo.`);
    }
    if (!Number.isSafeInteger(line.unitPriceCop) || line.unitPriceCop < 0) {
      return invalidLine(`El precio de "${line.name}" debe ser un entero COP no negativo.`);
    }

    const lineTotal = BigInt(line.quantity) * BigInt(line.unitPriceCop);
    const lineTotalCop = toSafeNumber(lineTotal);
    if (!lineTotalCop.ok) return lineTotalCop;

    subtotal += lineTotal;
    lines.push({ ...line, lineTotalCop: lineTotalCop.value, position: index + 1 });
  }

  const discount = applyRateCop(subtotal, rates.discountRateBp);
  const taxableBase = subtotal - discount;
  const tax = applyRateCop(taxableBase, rates.taxRateBp);
  const total = taxableBase + tax;
  const deposit = applyRateCop(total, rates.depositRateBp);

  // `total` es el mayor monto posible; si cabe, todos los demás también.
  const safeTotal = toSafeNumber(total);
  if (!safeTotal.ok) return safeTotal;
  const safeSubtotal = toSafeNumber(subtotal);
  if (!safeSubtotal.ok) return safeSubtotal;

  return ok({
    lines,
    totals: {
      depositCop: Number(deposit),
      discountCop: Number(discount),
      subtotalCop: safeSubtotal.value,
      taxCop: Number(tax),
      taxableBaseCop: Number(taxableBase),
      totalCop: safeTotal.value,
    },
  });
}
