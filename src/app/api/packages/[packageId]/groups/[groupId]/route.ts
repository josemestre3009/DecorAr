import { randomUUID } from "node:crypto";

import { createPackageController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ packageId: string; groupId: string }> | { packageId: string; groupId: string };
}

/** Respuesta 500 genérica con un id para cruzarla con el log del servidor. */
function uncaughtError(method: string, cause: unknown): Response {
  const correlationId = randomUUID();
  console.error(
    `[API ${method} /api/packages/[packageId]/groups/[groupId]] Uncaught error (${correlationId}):`,
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

/** Renombra un grupo decorativo (DECOR-43). */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId, groupId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleRenameGroup(request, packageId, groupId);
  } catch (cause) {
    return uncaughtError("PATCH", cause);
  }
}

/** Elimina un grupo decorativo promoviendo su contenido al padre (DECOR-43). */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId, groupId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleDeleteGroup(request, packageId, groupId);
  } catch (cause) {
    return uncaughtError("DELETE", cause);
  }
}
