import { createQuoteController, serverLogger } from "@/composition/server";
import { uncaughtRouteError } from "@/interfaces/http/uncaught-route-error";

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
    return uncaughtRouteError(serverLogger, "GET /api/quotes/[quoteId]/pdf", cause);
  }
}
