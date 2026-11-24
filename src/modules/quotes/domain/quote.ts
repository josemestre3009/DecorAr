/**
 * Cotización versionada (DECOR-50): instantánea inmutable de un paquete.
 *
 * Cada versión es un registro propio con su número, términos comerciales,
 * líneas y totales congelados. Cambiar el paquete o el catálogo después no
 * altera ninguna versión guardada; una versión nueva es otro registro con el
 * mismo número y `version + 1`.
 *
 * Los montos son pesos colombianos enteros (sin centavos), igual que
 * `catalog_modules.price_cop` y `budgets.total_cop`. Los porcentajes se
 * expresan en puntos básicos (1 % = 100 bp) para evitar decimales binarios.
 */

/** Moneda única de DecorAR. */
export const QUOTE_CURRENCY = "COP" as const;

/** Zona horaria comercial de DecorAR: la vigencia se compara con la fecha local. */
export const QUOTE_TIME_ZONE = "America/Bogota";

/** 100 % expresado en puntos básicos. */
export const BASIS_POINTS_100 = 10_000;

/** Concepto congelado tal como se leyó del paquete y del catálogo. */
export interface QuoteLineSnapshot {
  readonly moduleId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCop: number;
}

/** Línea guardada: el concepto más su posición y su subtotal calculado. */
export interface QuoteLine extends QuoteLineSnapshot {
  readonly position: number;
  readonly lineTotalCop: number;
}

/** Términos comerciales validados que el usuario define por versión. */
export interface QuoteTerms {
  /** Fecha ISO `YYYY-MM-DD` hasta la que la cotización es válida. */
  readonly validUntil: string;
  readonly discountRateBp: number;
  readonly taxRateBp: number;
  readonly depositRateBp: number;
  readonly conditions: string | null;
  /** Cliente opcional; si se omite se congela el `client_name` del evento. */
  readonly clientName: string | null;
}

/** Totales calculados en servidor, todos en COP entero. */
export interface QuoteTotals {
  readonly subtotalCop: number;
  readonly discountCop: number;
  /** Base gravable: subtotal menos descuento. */
  readonly taxableBaseCop: number;
  readonly taxCop: number;
  readonly totalCop: number;
  readonly depositCop: number;
}
