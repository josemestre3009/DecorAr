import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    getPackageDetail: { execute: vi.fn() },
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock, useRouter: () => ({}) }));
vi.mock("@/composition/server", () => ({
  createPackageQueryDependencies: vi.fn(async () => depsMock),
}));
vi.mock("@/composition/session-guard", () => ({ requireSessionUser: vi.fn() }));

const { default: GroupSetupPage, loadGroups } = await import("./page");

const DETAIL: PackageDetailView = {
  capacityM2: 30,
  id: "pkg-1",
  nodes: [
    {
      areaM2: 0,
      children: [{ areaM2: 0, children: [], groupId: "mesa", kind: "group", name: "Mesa", priceCop: 0 }],
      groupId: "sala",
      kind: "group",
      name: "Sala",
      priceCop: 0,
    },
  ],
  remainingM2: 30,
  spaceType: "casa",
  usedM2: 0,
  version: 3,
};

describe("organización de zonas: página de servidor (DECOR-43)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("en modo simulado no hay zonas: redirige al configurador", async () => {
    vi.stubEnv("NEXT_PUBLIC_DECOR_PACKAGES_API", "");

    await expect(GroupSetupPage({ params: Promise.resolve({ packageId: "pkg-1" }) })).rejects.toThrow(
      "NEXT_REDIRECT:/packages/pkg-1",
    );
    expect(depsMock.authorizePackageAccess.execute).not.toHaveBeenCalled();
  });

  it("extrae las zonas del detalle del servidor con su ruta", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(ok({ email: "a@b.co", id: "user-1" }));
    depsMock.getPackageDetail.execute.mockResolvedValue(ok(DETAIL));

    const setup = await loadGroups("pkg-1");

    expect(setup.status).toBe("ready");
    expect(setup.status === "ready" && setup.groups.map((g) => g.label)).toEqual(["Sala", "Sala › Mesa"]);
    expect(depsMock.getPackageDetail.execute).toHaveBeenCalledWith({ packageId: "pkg-1", userId: "user-1" });
  });

  it("un paquete ajeno o inexistente responde 404 sin leer el detalle", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("package.not_found", "No encontramos este paquete.")),
    );

    await expect(loadGroups("ajeno")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(depsMock.getPackageDetail.execute).not.toHaveBeenCalled();
  });

  it("sin sesión redirige a /login", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(
      err(new DomainError("auth.unauthenticated", "Inicia sesión.")),
    );

    await expect(loadGroups("pkg-1")).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("un fallo de lectura devuelve error con reintento", async () => {
    depsMock.authorizePackageAccess.execute.mockResolvedValue(ok({ email: "a@b.co", id: "user-1" }));
    depsMock.getPackageDetail.execute.mockResolvedValue(
      err(new DomainError("package.persistence_error", "boom")),
    );

    expect(await loadGroups("pkg-1")).toEqual({ status: "error" });
  });
});
