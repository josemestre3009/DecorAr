import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute, mockCheckPackageAccess } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockCheckPackageAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageAccessDependencies: vi.fn(async () => ({ authorizePackageAccess: {} })),
  createBudgetQueryDependencies: vi.fn(async () => ({ getBudget: { execute: mockExecute } })),
}));
vi.mock("@/interfaces/packages/package-access", () => ({
  checkPackageAccess: mockCheckPackageAccess,
}));

import { GET } from "./route";

const PARAMS = { params: Promise.resolve({ packageId: "pkg-1" }) };

describe("GET /api/packages/[packageId]/budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responde 200 con el presupuesto confirmado cuando el dueño tiene acceso", async () => {
    mockCheckPackageAccess.mockResolvedValue({ ok: true, user: { id: "user-1", email: "a@decorar.test" } });
    mockExecute.mockResolvedValue({
      ok: true,
      value: { packageId: "pkg-1", totalCop: 450000, currency: "COP", packageVersion: 3, updatedAt: "2026-10-08T00:00:00.000Z" },
    });

    const response = await GET(new Request("http://localhost/api/packages/pkg-1/budget"), PARAMS);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      totalCop: 450000,
      currency: "COP",
      packageVersion: 3,
      updatedAt: "2026-10-08T00:00:00.000Z",
    });
  });

  it("devuelve la respuesta de checkPackageAccess sin tocar el caso de uso cuando el acceso se niega", async () => {
    const denied = Response.json({ error: { code: "auth.unauthenticated", message: "x" } }, { status: 401 });
    mockCheckPackageAccess.mockResolvedValue({ ok: false, response: denied });

    const response = await GET(new Request("http://localhost/api/packages/pkg-1/budget"), PARAMS);

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("responde 404 con el envelope {error:{code,message}} cuando el presupuesto no existe", async () => {
    mockCheckPackageAccess.mockResolvedValue({ ok: true, user: { id: "user-1", email: "a@decorar.test" } });
    mockExecute.mockResolvedValue({ ok: false, error: { code: "budget.not_found", message: "no budget yet" } });

    const response = await GET(new Request("http://localhost/api/packages/pkg-1/budget"), PARAMS);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "budget.not_found", message: "no budget yet" } });
  });

  it("responde 500 controlado sin filtrar el detalle de un fallo inesperado del caso de uso", async () => {
    mockCheckPackageAccess.mockResolvedValue({ ok: true, user: { id: "user-1", email: "a@decorar.test" } });
    mockExecute.mockResolvedValue({ ok: false, error: { code: "budget.persistence_error", message: "db down" } });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(new Request("http://localhost/api/packages/pkg-1/budget"), PARAMS);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "internal_error", message: "No pudimos completar la operación." } });
    expect(body.error.message).not.toContain("db down");

    consoleSpy.mockRestore();
  });

  it("responde 500 controlado cuando algo lanza antes de llegar al caso de uso", async () => {
    mockCheckPackageAccess.mockRejectedValue(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(new Request("http://localhost/api/packages/pkg-1/budget"), PARAMS);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.message).not.toContain("boom");
    expect(body).not.toHaveProperty("stack");

    consoleSpy.mockRestore();
  });
});
