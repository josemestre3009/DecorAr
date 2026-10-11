import { randomUUID } from "node:crypto";

import { createRecoveryController } from "@/composition/server";
import { sanitizeLogContext } from "@/shared/application/sanitize-log-context";

export async function GET(request: Request): Promise<Response> {
  try {
    const controller = createRecoveryController();
    return await controller.handleList(request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API GET /api/internal/recovery] Uncaught error (${correlationId}):`,
      sanitizeLogContext({ cause }),
    );

    return Response.json(
      { correlationId, error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const controller = createRecoveryController();
    return await controller.handlePost(request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API POST /api/internal/recovery] Uncaught error (${correlationId}):`,
      sanitizeLogContext({ cause }),
    );

    return Response.json(
      { correlationId, error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { status: 500 },
    );
  }
}
