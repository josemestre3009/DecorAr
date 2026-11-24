import { randomUUID } from "node:crypto";

import { createQuoteController } from "@/composition/server";

/** El PDF se genera con librerías de Node (DECOR-52). */
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ quoteId: string }> | { quoteId: string };
}

/** `GET /api/quotes/{quoteId}/pdf`: descarga el PDF de la versión guardada. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteController();
    return await controller.handleGetPdf(request, quoteId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API GET /api/quotes/[quoteId]/pdf] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
