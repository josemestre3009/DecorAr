import { randomUUID } from "node:crypto";

import { createRecoveryController } from "@/composition/server";

export async function GET(request: Request): Promise<Response> {
  try {
    const controller = createRecoveryController();
    return await controller.handleList(request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API GET /api/internal/recovery] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      { correlationId, error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const action = new URL(request.url).searchParams.get("action");
    const controller = createRecoveryController();

    if (action === "retry") {
      return await controller.handleRetry(request);
    }

    if (action === "reconcile") {
      return await controller.handleReconcile(request);
    }

    return Response.json(
      {
        error: {
          code: "recovery.invalid_action",
          message: "El parámetro action debe ser 'retry' o 'reconcile'.",
        },
      },
      { status: 400 },
    );
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API POST /api/internal/recovery] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      { correlationId, error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { status: 500 },
    );
  }
}
