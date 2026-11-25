import { randomUUID } from "node:crypto";

import type { QuotePdfRenderer } from "../../modules/quotes/application/ports/quote-pdf-renderer.port";
import { quoteFileName } from "../../modules/quotes/application/quote-document";
import type { GetSharedQuoteUseCase } from "../../modules/quotes/application/use-cases/get-shared-quote.use-case";

const CORRELATION_ID_HEADER = "x-correlation-id";

export type SharedQuotePdfControllerDependencies = {
  readonly getSharedQuote: Pick<GetSharedQuoteUseCase, "execute">;
  readonly pdfRenderer: QuotePdfRenderer;
};

function correlationIdFor(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER);
  return provided && provided.trim().length > 0 ? provided.trim() : randomUUID();
}

const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/**
 * Descarga pública del PDF de una cotización compartida por enlace (DECOR-56).
 * Sin sesión: el token firmado es la credencial y `GetSharedQuoteUseCase`
 * verifica vigencia, revocación y estado (`sent`/`accepted`). Cualquier rechazo
 * devuelve 404 uniforme sin distinguir el motivo.
 */
export class SharedQuotePdfController {
  constructor(private readonly deps: SharedQuotePdfControllerDependencies) {}

  async handleGetPdf(request: Request, token: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const result = await this.deps.getSharedQuote.execute(token);
      if (!result.ok) {
        if (result.error.code === "quote.share_link_not_found") {
          return Response.json(
            { error: { code: result.error.code, message: result.error.message } },
            { headers: { ...SECURITY_HEADERS, [CORRELATION_ID_HEADER]: correlationId }, status: 404 },
          );
        }

        console.error(`[SharedQuotePdfController.getPdf] (${correlationId}):`, result.error.code, result.error.message);
        return Response.json(
          { error: { code: "internal_error", message: "No pudimos completar la operación." } },
          { headers: { ...SECURITY_HEADERS, [CORRELATION_ID_HEADER]: correlationId }, status: 500 },
        );
      }

      const quote = result.value;
      const pdf = await this.deps.pdfRenderer.render(quote);

      return new Response(pdf as BodyInit, {
        headers: {
          ...SECURITY_HEADERS,
          [CORRELATION_ID_HEADER]: correlationId,
          "content-disposition": `attachment; filename="${quoteFileName(quote)}"`,
          "content-length": String(pdf.byteLength),
          "content-type": "application/pdf",
        },
      });
    } catch (cause) {
      console.error(`[SharedQuotePdfController.getPdf] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: { ...SECURITY_HEADERS, [CORRELATION_ID_HEADER]: correlationId }, status: 500 },
      );
    }
  }
}
