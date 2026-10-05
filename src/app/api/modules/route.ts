import { randomUUID } from "node:crypto";

import { createCatalogController } from "@/composition/server";

export async function GET(): Promise<Response> {
  try {
    const controller = await createCatalogController();
    return await controller.handleGetModules();
  } catch (error) {
    const correlationId = randomUUID();
    console.error(
      `[API /api/modules] Uncaught initialization or execution error (correlationId: ${correlationId}):`,
      error,
    );

    return Response.json(
      {
        error: "Internal Server Error",
        correlationId,
      },
      { status: 500 },
    );
  }
}
