import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { QuoteDto } from "../../application/dtos/quote.dto";
import type { QuotePdfRenderer } from "../../application/ports/quote-pdf-renderer.port";
import { buildQuoteDocument } from "../../application/quote-document";

/** `public/` se copia junto al servidor standalone (`scripts/build.mjs`). */
export const DEFAULT_LOGO_PATH = join(process.cwd(), "public", "brand", "logo.png");

/**
 * PDF de la cotización en el servidor con `@react-pdf/renderer` (DECOR-52):
 * JavaScript puro, sin navegador headless, compatible con la imagen
 * `node:22-alpine`. La librería y la plantilla se cargan al generar el
 * primer PDF, no al importar la composición, para no pesar en las demás
 * rutas. El logo se lee una vez; si falta, el PDF sale sin él.
 */
export class ReactPdfQuoteRenderer implements QuotePdfRenderer {
  private logo: Promise<Buffer | null> | undefined;

  constructor(private readonly logoPath: string = DEFAULT_LOGO_PATH) {}

  private loadLogo(): Promise<Buffer | null> {
    this.logo ??= readFile(this.logoPath).catch((cause: unknown) => {
      console.warn("[ReactPdfQuoteRenderer] Logo no disponible; el PDF sale sin logo.", cause);
      return null;
    });
    return this.logo;
  }

  async render(quote: QuoteDto): Promise<Uint8Array> {
    const [{ renderToBuffer }, { QuotePdfDocument }, logo] = await Promise.all([
      import("@react-pdf/renderer"),
      import("./quote-pdf-document"),
      this.loadLogo(),
    ]);

    // La plantilla no usa hooks: se invoca directo para entregar el <Document>.
    const buffer = await renderToBuffer(
      QuotePdfDocument({ createdAt: new Date(quote.createdAt), document: buildQuoteDocument(quote), logo }),
    );
    return new Uint8Array(buffer);
  }
}
