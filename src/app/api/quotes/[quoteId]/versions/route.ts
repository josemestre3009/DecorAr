import { randomUUID } from "node:crypto";

import { createQuoteController } from "@/composition/server";

interface RouteContext {
  params: Promise<{ quoteId: string }> | { quoteId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { quoteId } = await context.params;
    const controller = await createQuoteController();
    return await controller.handleCreateVersion(request, quoteId);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API POST /api/quotes/[quoteId]/versions] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
