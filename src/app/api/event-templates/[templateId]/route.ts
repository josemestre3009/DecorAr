import { randomUUID } from "node:crypto";

import { createEventTemplateController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ templateId: string }> | { templateId: string };
}

async function templateIdOf(context: RouteContext): Promise<string> {
  const { templateId } = await context.params;
  return templateId;
}

async function guard(
  label: string,
  run: (templateId: string) => Promise<Response>,
  context: RouteContext,
): Promise<Response> {
  try {
    return await run(await templateIdOf(context));
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API ${label} /api/event-templates/[templateId]] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return guard("GET", async (templateId) => {
    const controller = await createEventTemplateController();
    return controller.handleGet(request, templateId);
  }, context);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return guard("PATCH", async (templateId) => {
    const controller = await createEventTemplateController();
    return controller.handleRename(request, templateId);
  }, context);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return guard("DELETE", async (templateId) => {
    const controller = await createEventTemplateController();
    return controller.handleDelete(request, templateId);
  }, context);
}
