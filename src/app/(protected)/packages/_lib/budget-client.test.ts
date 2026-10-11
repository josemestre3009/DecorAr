import { describe, expect, it, vi } from "vitest";

import { createHttpBudgetClient } from "./budget-client";

describe("createHttpBudgetClient (DECOR-21 / DECOR-33)", () => {
  it("obtiene el presupuesto confirmado con GET /api/packages/{id}/budget en 200 OK", async () => {
    const payload = {
      currency: "COP",
      packageVersion: 3,
      totalCop: 450000,
      updatedAt: "2026-10-08T00:00:00.000Z",
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload, { status: 200 }));
    const client = createHttpBudgetClient(fetcher);

    const result = await client.getBudget("pkg-123");

    expect(result).toEqual({ ok: true, value: payload });
    expect(fetcher).toHaveBeenCalledWith("/api/packages/pkg-123/budget", {
      headers: { Accept: "application/json" },
      method: "GET",
    });
  });

  it("retorna not_found cuando el paquete no tiene presupuesto calculado (404 budget.not_found)", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: "budget.not_found", message: "Este paquete todavía no tiene un presupuesto calculado." } },
        { status: 404 },
      ),
    );
    const client = createHttpBudgetClient(fetcher);

    const result = await client.getBudget("pkg-123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.code).toBe("budget.not_found");
    }
  });

  it("retorna unauthorized cuando la sesión expiró (401)", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: "auth.unauthenticated", message: "Inicia sesión para continuar." } },
        { status: 401 },
      ),
    );
    const client = createHttpBudgetClient(fetcher);

    const result = await client.getBudget("pkg-123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthorized");
    }
  });

  it("retorna server failure cuando hay error 500 controlado", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { status: 500 },
      ),
    );
    const client = createHttpBudgetClient(fetcher);

    const result = await client.getBudget("pkg-123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("server");
    }
  });

  it("retorna network failure ante error de red", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("Network disconnect"));
    const client = createHttpBudgetClient(fetcher);

    const result = await client.getBudget("pkg-123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("network");
    }
  });

  it("retorna unexpected response si el cuerpo 200 no cumple el esquema", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ something: "else" }, { status: 200 }));
    const client = createHttpBudgetClient(fetcher);

    const result = await client.getBudget("pkg-123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("server");
    }
  });
});
