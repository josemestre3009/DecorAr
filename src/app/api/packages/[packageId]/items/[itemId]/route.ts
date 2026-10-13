import { randomUUID } from "node:crypto";

import { createPackageController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ packageId: string; itemId: string }> | { packageId: string; itemId: string };
}

/** `PATCH /api/packages/{packageId}/items/{itemId}`: mueve la instancia entre zonas. */
export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { packageId, itemId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleMoveItem(request, packageId, itemId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API PATCH /api/packages/[packageId]/items/[itemId]] Uncaught error (${correlationId}):`,
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

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { packageId, itemId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleRemoveItem(packageId, itemId, request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API DELETE /api/packages/[packageId]/items/[itemId]] Uncaught error (${correlationId}):`,
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
