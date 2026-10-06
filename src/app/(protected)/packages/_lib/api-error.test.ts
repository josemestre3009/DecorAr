import { describe, expect, it } from "vitest";

import { networkFailure, readApiError } from "./api-error";

const json = (body: unknown, status: number) => Response.json(body, { status });

describe("readApiError", () => {
  it("muestra el mensaje del envelope {error:{code,message}} en un 422", async () => {
    await expect(
      readApiError(
        json({ error: { code: "package.invalid_capacity", message: "Capacidad inválida." } }, 422),
      ),
    ).resolves.toEqual({
      code: "package.invalid_capacity",
      kind: "invalid",
      message: "Capacidad inválida.",
      status: 422,
    });
  });

  it("acepta el formato actual de /api/modules sin exponer el detalle del 500", async () => {
    const failure = await readApiError(
      json({ error: "Internal Server Error", correlationId: "abc" }, 500),
    );

    expect(failure).toEqual({
      code: "Internal Server Error",
      kind: "server",
      message: "Tuvimos un problema en el servidor. Inténtalo de nuevo.",
      status: 500,
    });
  });

  it("nunca muestra el mensaje del servidor en un 5xx", async () => {
    const failure = await readApiError(
      json({ error: { code: "x", message: "relation catalog_modules does not exist" } }, 503),
    );

    expect(failure.message).not.toMatch(/catalog_modules/);
  });

  it("marca el 401 como sesión terminada", async () => {
    const failure = await readApiError(json({ error: "unauthorized" }, 401));

    expect(failure.kind).toBe("unauthorized");
    expect(failure.message).toBe("Tu sesión terminó. Inicia sesión de nuevo.");
  });

  it("tolera respuestas sin JSON", async () => {
    const failure = await readApiError(new Response("<html>", { status: 404 }));

    expect(failure).toEqual({
      code: undefined,
      kind: "not_found",
      message: "No encontramos lo que buscabas.",
      status: 404,
    });
  });
});

describe("networkFailure", () => {
  it("describe la falta de conexión", () => {
    expect(networkFailure().kind).toBe("network");
  });
});
