import { createQuoteController, serverLogger } from "@/composition/server";
import { uncaughtRouteError } from "@/interfaces/http/uncaught-route-error";

interface RouteContext {
  params: Promise<{ packageId: string }> | { packageId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId } = await context.params;
    const controller = await createQuoteController();
    return await controller.handleCreate(request, packageId);
  } catch (cause) {
    return uncaughtRouteError(serverLogger, "POST /api/packages/[packageId]/quotes", cause);
  }
}
