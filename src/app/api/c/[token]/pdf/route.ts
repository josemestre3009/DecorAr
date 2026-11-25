import { randomUUID } from "node:crypto";

import { createSharedQuotePdfController } from "@/composition/server";

/** El PDF se genera con librerías de Node (DECOR-52 / DECOR-56). */
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/** `GET /api/c/{token}/pdf`: descarga pública del PDF de una cotización compartida. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { token } = await context.params;
    const controller = createSharedQuotePdfController();
    return await controller.handleGetPdf(request, token);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API GET /api/c/[token]/pdf] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      {
        headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
        status: 500,
      },
    );
  }
}
