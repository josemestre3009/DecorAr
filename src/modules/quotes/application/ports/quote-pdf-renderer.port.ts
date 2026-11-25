import type { QuoteDocumentSource } from "../quote-document";

/**
 * Genera el PDF de una versión guardada de cotización (DECOR-52 / DECOR-56). La
 * implementación sólo puede usar los datos de `quote`; nunca la hora actual
 * ni otra lectura, para que una versión histórica dé siempre el mismo PDF.
 */
export interface QuotePdfRenderer {
  render(quote: QuoteDocumentSource): Promise<Uint8Array>;
}
