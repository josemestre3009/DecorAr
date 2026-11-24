import type { QuoteShareLinkDto } from "../application/dtos/quote.dto";

/** Forma que devuelven `create_quote_share_link`, `get_quote_share_link` y `revoke_quote_share_link`. */
export type QuoteShareLinkRow = {
  id: string;
  quoteId: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
};

export function mapQuoteShareLinkRow(row: QuoteShareLinkRow): QuoteShareLinkDto {
  return {
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    id: row.id,
    quoteId: row.quoteId,
    revokedAt: row.revokedAt,
  };
}
