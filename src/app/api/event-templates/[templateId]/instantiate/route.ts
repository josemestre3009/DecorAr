import { randomUUID } from "node:crypto";

import { createEventTemplateController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ templateId: string }> | { templateId: string };
}

/** `POST /api/event-templates/{templateId}/instantiate` (DECOR-44): crea un evento propio. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { templateId } = await context.params;
    const controller = await createEventTemplateController();
    return await controller.handleInstantiate(request, templateId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(
      `[API POST /api/event-templates/[templateId]/instantiate] Uncaught error (${correlationId}):`,
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
