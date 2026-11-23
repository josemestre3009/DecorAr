import { randomUUID } from "node:crypto";

import { createSceneController } from "@/composition/server";

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
    const correlationId = randomUUID();
    console.error(
      `[API GET /api/packages/[packageId]/scene] Uncaught error (${correlationId}):`,
      cause,
    );

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}

/** `PUT /api/packages/{packageId}/scene`: reemplaza la posición de cada unidad. */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId } = await context.params;
    const controller = await createSceneController();
    return await controller.handlePut(request, packageId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API PUT /api/packages/[packageId]/scene] Uncaught error (${correlationId}):`,
      cause,
    );

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
