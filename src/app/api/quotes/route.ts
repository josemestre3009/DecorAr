import { createQuoteController, serverLogger } from "@/composition/server";
import { uncaughtRouteError } from "@/interfaces/http/uncaught-route-error";

export async function GET(request: Request): Promise<Response> {
  try {
    const controller = await createQuoteController();
    return await controller.handleList(request);
  } catch (cause) {
    return uncaughtRouteError(serverLogger, "GET /api/quotes", cause);
  }
}
