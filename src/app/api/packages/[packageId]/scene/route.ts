import { createSceneController, serverLogger } from "@/composition/server";
import { uncaughtRouteError } from "@/interfaces/http/uncaught-route-error";

interface RouteContext {
  params: Promise<{ packageId: string }> | { packageId: string };
}

/** `GET /api/packages/{packageId}/scene`: lee la posición de cada unidad. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId } = await context.params;
    const controller = await createSceneController();
    return await controller.handleGet(request, packageId);
  } catch (cause) {
    return uncaughtRouteError(serverLogger, "GET /api/packages/[packageId]/scene", cause);
  }
}

/** `PUT /api/packages/{packageId}/scene`: reemplaza la posición de cada unidad. */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId } = await context.params;
    const controller = await createSceneController();
    return await controller.handlePut(request, packageId);
  } catch (cause) {
    return uncaughtRouteError(serverLogger, "PUT /api/packages/[packageId]/scene", cause);
  }
}
