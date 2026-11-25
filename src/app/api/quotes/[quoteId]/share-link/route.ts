import { createQuoteShareLinkController, serverLogger } from "@/composition/server";
import { uncaughtRouteError } from "@/interfaces/http/uncaught-route-error";

interface RouteContext {
  params: Promise<{ quoteId: string }> | { quoteId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteShareLinkController();
    return await controller.handleCreate(request, quoteId);
  } catch (cause) {
    return uncaughtRouteError(serverLogger, "POST /api/quotes/[quoteId]/share-link", cause);
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteShareLinkController();
    return await controller.handleGet(request, quoteId);
  } catch (cause) {
    return uncaughtRouteError(serverLogger, "GET /api/quotes/[quoteId]/share-link", cause);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteShareLinkController();
    return await controller.handleRevoke(request, quoteId);
  } catch (cause) {
    return uncaughtRouteError(serverLogger, "DELETE /api/quotes/[quoteId]/share-link", cause);
  }
}
