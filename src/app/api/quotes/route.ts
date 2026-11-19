import { randomUUID } from "node:crypto";

import { createQuoteController } from "@/composition/server";

export async function GET(request: Request): Promise<Response> {
  try {
    const controller = await createQuoteController();
    return await controller.handleList(request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API GET /api/quotes] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
