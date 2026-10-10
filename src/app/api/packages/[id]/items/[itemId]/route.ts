import { randomUUID } from "node:crypto";

import { createPackageController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ id: string; itemId: string }> | { id: string; itemId: string };
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id, itemId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleRemoveItem(id, itemId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API DELETE /api/packages/[id]/items/[itemId]] Uncaught error (${correlationId}):`,
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
