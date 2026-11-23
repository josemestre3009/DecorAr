import type { QUOTE_CURRENCY, QuoteTotals } from "../../domain/quote";
import type { QuoteStatus } from "../../domain/quote-status";
import type { QuoteTermsInput } from "../../domain/quote-terms";

/** Concepto congelado tal como lo devuelve la API. */
export type QuoteLineDto = {
  readonly position: number;
  readonly moduleId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCop: number;
  readonly lineTotalCop: number;
};

/**
 * Contrato de una versión de cotización (DECOR-50). Es lo que consumen la
 * vista previa (DECOR-51), el PDF (DECOR-52) y el enlace público (DECOR-53).
 * Todos los montos son COP enteros; las tasas, puntos básicos (1 % = 100).
 */
export type QuoteDto = {
  readonly id: string;
  readonly number: number;
  readonly version: number;
  readonly status: QuoteStatus;
  /** `null` si el evento de origen fue eliminado; la cotización se conserva. */
  readonly packageId: string | null;
  readonly sourcePackageVersion: number;
  readonly currency: typeof QUOTE_CURRENCY;
  readonly client: { readonly name: string | null };
  readonly event: {
    readonly name: string;
    readonly date: string | null;
    readonly venue: string | null;
    readonly type: string | null;
  };
  readonly validUntil: string;
  readonly conditions: string | null;
  readonly terms: {
    readonly discountRateBp: number;
    readonly taxRateBp: number;
    readonly depositRateBp: number;
  };
  readonly totals: QuoteTotals;
  readonly lines: readonly QuoteLineDto[];
  readonly createdAt: string;
  readonly statusChangedAt: string;
};

/** Fila del listado: sin líneas. */
export type QuoteSummaryDto = {
  readonly id: string;
  readonly number: number;
  readonly version: number;
  readonly status: QuoteStatus;
  readonly packageId: string | null;
  readonly eventName: string;
  readonly clientName: string | null;
  readonly validUntil: string;
  readonly totalCop: number;
  readonly createdAt: string;
};

export type CreateQuoteDto = {
  readonly ownerId: string;
  readonly packageId: string;
  readonly terms: QuoteTermsInput;
};

export type CreateQuoteVersionDto = {
  readonly ownerId: string;
  readonly quote: QuoteDto;
  readonly terms: QuoteTermsInput;
};

export type ChangeQuoteStatusDto = {
  readonly ownerId: string;
  readonly quote: QuoteDto;
  readonly status: unknown;
};
