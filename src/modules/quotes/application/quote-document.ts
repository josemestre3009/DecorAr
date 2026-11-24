import type { QuoteDto } from "./dtos/quote.dto";
import type { QuoteStatus } from "../domain/quote-status";

/**
 * Contenido comercial de una cotización listo para imprimir (DECOR-52).
 * Función pura: sólo lee la versión guardada (precios y totales congelados
 * por el servidor) y nunca la hora actual, así que la misma versión produce
 * siempre el mismo contenido. Los textos coinciden con la vista previa
 * (DECOR-51): COP sin decimales, tasas en %, fechas es-CO y "Sin definir".
 */
export type QuoteDocument = {
  readonly title: string;
  readonly fileName: string;
  readonly statusLabel: string;
  readonly validUntil: string;
  readonly issuedOn: string;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly lines: readonly {
    readonly key: string;
    readonly concept: string;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly subtotal: string;
  }[];
  readonly totals: readonly { readonly label: string; readonly value: string; readonly emphasis: boolean }[];
  readonly conditions: string | null;
};

export const NOT_DEFINED = "Sin definir";

const BASIS_POINTS_PER_PERCENT = 100;

const STATUS_LABELS: Readonly<Record<QuoteStatus, string>> = {
  accepted: "Aceptada",
  draft: "Borrador",
  expired: "Vencida",
  sent: "Enviada",
};

const copFormatter = new Intl.NumberFormat("es-CO", {
  currency: "COP",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: "currency",
});
const percentFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

/**
 * Las fuentes estándar del PDF (WinAnsi) no traen el espacio estrecho
 * (U+202F) que algunas versiones de ICU usan en es-CO ni el signo menos
 * (U+2212); se cambian por un espacio duro y un guion.
 */
function pdfSafe(text: string): string {
  return text.replace(/[  ]/g, " ").replace(/−/g, "-");
}

export function formatCopForDocument(value: number): string {
  return pdfSafe(copFormatter.format(value));
}

function formatRate(rateBp: number): string {
  return pdfSafe(`${percentFormatter.format(rateBp / BASIS_POINTS_PER_PERCENT)} %`);
}

/** Igual que `formatEventDate` de la vista previa: `YYYY-MM-DD` se lee como fecha local. */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? null : pdfSafe(dateFormatter.format(parsed));
}

/** Nombre de descarga, p. ej. `cotizacion-12-v2.pdf` (sólo ASCII). */
export function quoteFileName(quote: Pick<QuoteDto, "number" | "version">): string {
  return `cotizacion-${quote.number}-v${quote.version}.pdf`;
}

export function buildQuoteDocument(quote: QuoteDto): QuoteDocument {
  const { client, event, terms, totals } = quote;

  return {
    conditions: quote.conditions?.trim() ? quote.conditions.trim() : null,
    facts: [
      { label: "Cliente", value: client.name ?? NOT_DEFINED },
      { label: "Evento", value: event.name },
      { label: "Fecha", value: formatDate(event.date) ?? NOT_DEFINED },
      { label: "Lugar", value: event.venue ?? NOT_DEFINED },
      { label: "Tipo de evento", value: event.type ?? NOT_DEFINED },
    ],
    fileName: quoteFileName(quote),
    issuedOn: formatDate(quote.createdAt.slice(0, 10)) ?? quote.createdAt.slice(0, 10),
    lines: quote.lines.map((line) => ({
      concept: line.name,
      key: `${line.position}`,
      quantity: pdfSafe(integerFormatter.format(line.quantity)),
      subtotal: formatCopForDocument(line.lineTotalCop),
      unitPrice: formatCopForDocument(line.unitPriceCop),
    })),
    statusLabel: STATUS_LABELS[quote.status],
    title: `Cotización N.º ${quote.number} · versión ${quote.version}`,
    totals: [
      { emphasis: false, label: "Subtotal", value: formatCopForDocument(totals.subtotalCop) },
      {
        emphasis: false,
        label: `Descuento (${formatRate(terms.discountRateBp)})`,
        value:
          totals.discountCop > 0 ? `- ${formatCopForDocument(totals.discountCop)}` : formatCopForDocument(0),
      },
      { emphasis: false, label: "Base gravable", value: formatCopForDocument(totals.taxableBaseCop) },
      { emphasis: false, label: `Impuestos (${formatRate(terms.taxRateBp)})`, value: formatCopForDocument(totals.taxCop) },
      { emphasis: true, label: "Total", value: formatCopForDocument(totals.totalCop) },
      {
        emphasis: false,
        label: `Anticipo (${formatRate(terms.depositRateBp)} del total)`,
        value: formatCopForDocument(totals.depositCop),
      },
    ],
    validUntil: formatDate(quote.validUntil) ?? quote.validUntil,
  };
}
