import { randomUUID } from "node:crypto";

import { createPackageController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ packageId: string }> | { packageId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { packageId } = await context.params;
    const controller = await createPackageController();
    return await controller.handleClonePackage(request, packageId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API POST /api/packages/[packageId]/clone] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
