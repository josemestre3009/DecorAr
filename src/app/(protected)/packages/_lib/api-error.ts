/**
 * Traduce una respuesta HTTP fallida a un mensaje que la interfaz puede mostrar.
 *
 * El envelope acordado es `{error:{code,message}}`, pero `GET /api/modules`
 * (DECOR-28) responde hoy `{error:"Internal Server Error", correlationId}`, así
 * que se aceptan ambos. Los mensajes del servidor solo se muestran en 4xx: en un
 * 5xx podrían describir detalles internos.
 */

export type ApiFailureKind = "unauthorized" | "invalid" | "not_found" | "server" | "network";

export type ApiFailure = {
  readonly kind: ApiFailureKind;
  readonly message: string;
  readonly code?: string;
  readonly status?: number;
};

const MESSAGES: Record<ApiFailureKind, string> = {
  unauthorized: "Tu sesión terminó. Inicia sesión de nuevo.",
  invalid: "Revisa los datos e inténtalo de nuevo.",
  not_found: "No encontramos lo que buscabas.",
  server: "Tuvimos un problema en el servidor. Inténtalo de nuevo.",
  network: "No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.",
};

function kindOf(status: number): ApiFailureKind {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status >= 400 && status < 500) return "invalid";

  return "server";
}

function readEnvelope(body: unknown): { code?: string; message?: string } {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return {};
  }

  const { error } = body;

  if (typeof error === "string") {
    return { code: error };
  }

  if (typeof error === "object" && error !== null) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    const message =
      "message" in error && typeof error.message === "string" ? error.message : undefined;

    return { code, message };
  }

  return {};
}

export async function readApiError(response: Response): Promise<ApiFailure> {
  const kind = kindOf(response.status);
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const { code, message } = readEnvelope(body);
  const showServerMessage = kind === "invalid" || kind === "not_found";

  return {
    code,
    kind,
    message: showServerMessage && message ? message : MESSAGES[kind],
    status: response.status,
  };
}

export function networkFailure(): ApiFailure {
  return { kind: "network", message: MESSAGES.network };
}

export function unexpectedResponseFailure(status: number): ApiFailure {
  return { kind: "server", message: MESSAGES.server, status };
}
