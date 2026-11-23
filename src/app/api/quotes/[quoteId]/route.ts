import { randomUUID } from "node:crypto";

import { createQuoteController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ quoteId: string }> | { quoteId: string };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteController();
    return await controller.handleGet(request, quoteId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API GET /api/quotes/[quoteId]] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
