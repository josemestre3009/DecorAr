import { QUOTE_CURRENCY } from "../domain/quote";
import { isQuoteStatus, type QuoteStatus } from "../domain/quote-status";
import type { QuoteDto, QuoteLineDto, QuoteSummaryDto } from "../application/dtos/quote.dto";

/** Fila de `public.quote_lines` (también dentro de `private.quote_json`). */
export type QuoteLineRow = {
  position: number;
  module_id: string;
  name: string;
  quantity: number;
  unit_price_cop: number | string;
  line_total_cop: number | string;
};

/**
 * Fila de `public.quotes` con sus líneas embebidas. Es la misma forma que
 * devuelven `select('*, quote_lines(*)')` (lecturas bajo RLS) y los RPC
 * (`private.quote_json`), así que un único mapeo sirve para ambos.
 */
export type QuoteRow = {
  id: string;
  package_id: string | null;
  source_package_version: number;
  quote_number: number;
  version: number;
  status: string;
  client_name: string | null;
  event_name: string;
  event_date: string | null;
  venue: string | null;
  event_type: string | null;
  valid_until: string;
  conditions: string | null;
  discount_rate_bp: number;
  tax_rate_bp: number;
  deposit_rate_bp: number;
  subtotal_cop: number | string;
  discount_cop: number | string;
  tax_cop: number | string;
  total_cop: number | string;
  deposit_cop: number | string;
  created_at: string;
  status_changed_at: string;
  quote_lines?: QuoteLineRow[] | null;
};

export const QUOTE_COLUMNS = "*, quote_lines(*)";
export const QUOTE_SUMMARY_COLUMNS =
  "id, quote_number, version, status, package_id, event_name, client_name, valid_until, total_cop, created_at";

// Los BIGINT pueden llegar como texto según el cliente; los montos siempre
// caben en un entero seguro porque el dominio lo verificó al calcularlos.
const cop = (value: number | string): number => Number(value);

const statusOf = (value: string): QuoteStatus => (isQuoteStatus(value) ? value : "draft");

function mapLine(row: QuoteLineRow): QuoteLineDto {
  return {
    lineTotalCop: cop(row.line_total_cop),
    moduleId: row.module_id,
    name: row.name,
    position: row.position,
    quantity: row.quantity,
    unitPriceCop: cop(row.unit_price_cop),
  };
}

export function mapQuoteRow(row: QuoteRow): QuoteDto {
  const subtotalCop = cop(row.subtotal_cop);
  const discountCop = cop(row.discount_cop);

  return {
    client: { name: row.client_name },
    conditions: row.conditions,
    createdAt: row.created_at,
    currency: QUOTE_CURRENCY,
    event: {
      date: row.event_date,
      name: row.event_name,
      type: row.event_type,
      venue: row.venue,
    },
    id: row.id,
    lines: [...(row.quote_lines ?? [])].sort((a, b) => a.position - b.position).map(mapLine),
    number: row.quote_number,
    packageId: row.package_id,
    sourcePackageVersion: row.source_package_version,
    status: statusOf(row.status),
    statusChangedAt: row.status_changed_at,
    terms: {
      depositRateBp: row.deposit_rate_bp,
      discountRateBp: row.discount_rate_bp,
      taxRateBp: row.tax_rate_bp,
    },
    totals: {
      depositCop: cop(row.deposit_cop),
      discountCop,
      subtotalCop,
      taxCop: cop(row.tax_cop),
      taxableBaseCop: subtotalCop - discountCop,
      totalCop: cop(row.total_cop),
    },
    validUntil: row.valid_until,
    version: row.version,
  };
}

export type QuoteSummaryRow = Pick<
  QuoteRow,
  | "id"
  | "quote_number"
  | "version"
  | "status"
  | "package_id"
  | "event_name"
  | "client_name"
  | "valid_until"
  | "total_cop"
  | "created_at"
>;

export function mapQuoteSummaryRow(row: QuoteSummaryRow): QuoteSummaryDto {
  return {
    clientName: row.client_name,
    createdAt: row.created_at,
    eventName: row.event_name,
    id: row.id,
    number: row.quote_number,
    packageId: row.package_id,
    status: statusOf(row.status),
    totalCop: cop(row.total_cop),
    validUntil: row.valid_until,
    version: row.version,
  };
}
