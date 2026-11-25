import { createQuoteController, serverLogger } from "@/composition/server";
import { uncaughtRouteError } from "@/interfaces/http/uncaught-route-error";

interface RouteContext {
  params: Promise<{ quoteId: string }> | { quoteId: string };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteController();
    return await controller.handleGet(request, quoteId);
  } catch (cause) {
    return uncaughtRouteError(serverLogger, "GET /api/quotes/[quoteId]", cause);
  }
}
