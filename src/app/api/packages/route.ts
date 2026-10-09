import { randomUUID } from "node:crypto";

import { createPackageController } from "@/composition/server";

export async function POST(request: Request): Promise<Response> {
  try {
    const controller = await createPackageController();
    return await controller.handleCreatePackage(request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API POST /api/packages] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
