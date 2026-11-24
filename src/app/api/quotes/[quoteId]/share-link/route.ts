import { randomUUID } from "node:crypto";

import { createQuoteShareLinkController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ quoteId: string }> | { quoteId: string };
}

function internalError(cause: unknown, label: string): Response {
  const correlationId = randomUUID();
  console.error(`[API ${label}] Uncaught error (${correlationId}):`, cause);

  return Response.json(
    {
      correlationId,
      error: { code: "internal_error", message: "No pudimos completar la operación." },
    },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteShareLinkController();
    return await controller.handleCreate(request, quoteId);
  } catch (cause) {
    return internalError(cause, "POST /api/quotes/[quoteId]/share-link");
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteShareLinkController();
    return await controller.handleGet(request, quoteId);
  } catch (cause) {
    return internalError(cause, "GET /api/quotes/[quoteId]/share-link");
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteShareLinkController();
    return await controller.handleRevoke(request, quoteId);
  } catch (cause) {
    return internalError(cause, "DELETE /api/quotes/[quoteId]/share-link");
  }
}
