import { randomUUID } from "node:crypto";

import { createPackageController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ packageId: string }> | { packageId: string };
}

/** `PATCH /api/packages/{packageId}`: metadatos del evento, solo el propietario (DECOR-44). */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleUpdatePackage(request, packageId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API PATCH /api/packages/[packageId]] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
