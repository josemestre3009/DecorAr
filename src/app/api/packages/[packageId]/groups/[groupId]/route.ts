import { randomUUID } from "node:crypto";

import { createPackageController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ packageId: string; groupId: string }> | { packageId: string; groupId: string };
}

/** `PATCH /api/packages/{packageId}/groups/{groupId}`: renombra y/o mueve una zona. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId, groupId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleUpdateGroup(request, packageId, groupId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API PATCH /api/packages/[packageId]/groups/[groupId]] Uncaught error (${correlationId}):`,
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

/** `DELETE /api/packages/{packageId}/groups/{groupId}`: elimina una zona con estrategia. */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId, groupId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleDeleteGroup(request, packageId, groupId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API DELETE /api/packages/[packageId]/groups/[groupId]] Uncaught error (${correlationId}):`,
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
