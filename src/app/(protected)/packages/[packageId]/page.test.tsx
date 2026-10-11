import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/shared/domain/domain-error";
import { err, ok } from "@/shared/domain/result";

import type { PackageDetailView } from "@/modules/packages/application/dtos/package-detail.dto";

const { notFoundMock, redirectMock, depsMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirectMock: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  depsMock: {
    authorizePackageAccess: { execute: vi.fn() },
    getBudget: { execute: vi.fn() },
    getPackageDetail: { execute: vi.fn() },
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock }));
vi.mock("@/composition/server", () => ({
  createPackageQueryDependencies: vi.fn(async () => depsMock),
}));
vi.mock("@/composition/session-guard", () => ({ requireSessionUser: vi.fn() }));

const { loadConfigurator } = await import("./page");

const DETAIL: PackageDetailView = {
  capacityM2: 30,
  id: "pkg-1",
  nodes: [],
  remainingM2: 30,
  spaceType: "casa",
  usedM2: 0,
  version: 3,
};

describe("loadConfigurator (Server Component del configurador, DECOR-22)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("un paquete ajeno o inexistente responde 404 sin leer el detalle", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("package.not_found", "No encontramos este paquete.")),
    );

    await expect(loadConfigurator("ajeno")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(depsMock.getPackageDetail.execute).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("sin sesión redirige a /login", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("auth.unauthenticated", "Inicia sesión.")),
    );

    await expect(loadConfigurator("pkg-1")).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("un fallo de autorización devuelve error con reintento", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("package.persistence_error", "boom")),
    );

    await expect(loadConfigurator("pkg-1")).resolves.toEqual({ status: "error" });
  });

  it("un detalle no encontrado responde 404", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(ok({ id: "user-1" }));
    depsMock.getPackageDetail.execute.mockResolvedValue(
      err(new DomainError("package.not_found", "No encontramos este paquete.")),
    );

    await expect(loadConfigurator("pkg-1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(depsMock.getPackageDetail.execute).toHaveBeenCalledWith({ packageId: "pkg-1", userId: "user-1" });
  });

  it("presupuesto sin calcular queda pendiente", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(ok({ id: "user-1" }));
    depsMock.getPackageDetail.execute.mockResolvedValue(ok(DETAIL));
    depsMock.getBudget.execute.mockResolvedValue(err(new DomainError("budget.not_found", "sin presupuesto")));

    await expect(loadConfigurator("pkg-1")).resolves.toEqual({
      budget: { status: "pending" },
      detail: DETAIL,
      status: "ready",
    });
  });

  it("un fallo de presupuesto se muestra como error, no como pendiente", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(ok({ id: "user-1" }));
    depsMock.getPackageDetail.execute.mockResolvedValue(ok(DETAIL));
    depsMock.getBudget.execute.mockResolvedValue(err(new DomainError("budget.persistence_error", "boom")));

    const result = await loadConfigurator("pkg-1");

    expect(result.status).toBe("ready");
    expect(result.status === "ready" && result.budget).toEqual({ status: "error" });
  });

  it("el total confirmado llega con la versión del paquete", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(ok({ id: "user-1" }));
    depsMock.getPackageDetail.execute.mockResolvedValue(ok(DETAIL));
    depsMock.getBudget.execute.mockResolvedValue(
      ok({ currency: "COP", packageId: "pkg-1", packageVersion: 3, totalCop: 1050000, updatedAt: "now" }),
    );

    const result = await loadConfigurator("pkg-1");

    expect(result.status === "ready" && result.budget).toEqual({
      packageVersion: 3,
      status: "confirmed",
      totalCop: 1050000,
    });
  });
});
