import { randomUUID } from "node:crypto";

import { createEventTemplateController } from "@/composition/server";

export async function GET(request: Request): Promise<Response> {
  try {
    const controller = await createEventTemplateController();
    return await controller.handleList(request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API GET /api/event-templates] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const controller = await createEventTemplateController();
    return await controller.handleCreate(request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API POST /api/event-templates] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
