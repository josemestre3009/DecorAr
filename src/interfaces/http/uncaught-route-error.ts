import { randomUUID } from "node:crypto";

import type { Logger } from "../../shared/application/ports";

/**
 * Respuesta de un Route Handler cuando algo falla antes o fuera del
 * controlador, por ejemplo al construirlo (DECOR-55). El detalle va sólo al
 * `Logger`, que sanitiza el contexto; el cliente recibe un 500 genérico con el
 * `correlationId` para poder buscarlo en el log.
 */
export function uncaughtRouteError(logger: Pick<Logger, "error">, route: string, cause: unknown): Response {
  const correlationId = randomUUID();
  logger.error("route.uncaught_error", { component: route, correlationId, error: cause });

  return Response.json(
    {
      correlationId,
      error: { code: "internal_error", message: "No pudimos completar la operación." },
    },
    { status: 500 },
  );
}
