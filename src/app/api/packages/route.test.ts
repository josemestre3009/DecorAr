import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/shared/domain/domain-error";
import { err, ok } from "@/shared/domain/result";

const {
  mockCreatePackageController,
  mockHandleCreatePackage,
  mockCurrentUser,
  mockListOwnedPackages,
  mockListDependencies,
} = vi.hoisted(() => ({
  mockCreatePackageController: vi.fn(),
  mockHandleCreatePackage: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockListOwnedPackages: vi.fn(),
  mockListDependencies: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: mockCreatePackageController,
  createPackageListQueryDependencies: mockListDependencies,
}));

import { GET, POST } from "./route";

describe("GET /api/packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePackageController.mockResolvedValue({
      handleCreatePackage: mockHandleCreatePackage,
      handleListPackages: vi.fn(),
    });
    mockListDependencies.mockResolvedValue({
      currentUser: mockCurrentUser,
      defaultHeaders: {},
      listOwnedPackages: { execute: mockListOwnedPackages },
    });
  });

  it("usa la fábrica mínima de listado y no construye createPackageController", async () => {
    mockCurrentUser.mockResolvedValue({ email: "ana@example.com", id: "user-1" });
    mockListOwnedPackages.mockResolvedValue(ok([
      { capacityM2: 20, id: "pkg-1", spaceType: "casa", updatedAt: "2026-10-12T15:00:00Z" },
    ]));

    const response = await GET(new Request("http://localhost/api/packages"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      packages: [
        { capacityM2: 20, id: "pkg-1", spaceType: "casa", updatedAt: "2026-10-12T15:00:00Z" },
      ],
    });
    expect(mockListOwnedPackages).toHaveBeenCalledWith("user-1");
    expect(mockListDependencies).toHaveBeenCalledTimes(1);
    expect(mockCreatePackageController).not.toHaveBeenCalled();
  });

  it("devuelve 401 sin sesión y no consulta paquetes", async () => {
    mockCurrentUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/packages"));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("auth.unauthenticated");
    expect(mockListOwnedPackages).not.toHaveBeenCalled();
    expect(mockCreatePackageController).not.toHaveBeenCalled();
  });

  it("oculta el detalle de fallos de persistencia con un 500 genérico", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCurrentUser.mockResolvedValue({ email: "ana@example.com", id: "user-1" });
    mockListOwnedPackages.mockResolvedValue(
      err(new DomainError("package.persistence_error", "secret database detail")),
    );

    const response = await GET(new Request("http://localhost/api/packages"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toEqual({
      code: "internal_error",
      message: "No pudimos completar la operación.",
    });
    expect(JSON.stringify(body)).not.toContain("secret database detail");
    consoleSpy.mockRestore();
  });

  it("conserva x-correlation-id y los encabezados de refresh/anti-cache", async () => {
    const antiCache = "private, no-cache, no-store, must-revalidate, max-age=0";
    const defaultHeaders: Record<string, string> = {};
    mockListDependencies.mockResolvedValue({
      currentUser: async () => {
        defaultHeaders["Cache-Control"] = antiCache;
        return { email: "ana@example.com", id: "user-1" };
      },
      defaultHeaders,
      listOwnedPackages: { execute: mockListOwnedPackages },
    });
    mockListOwnedPackages.mockResolvedValue(ok([]));

    const response = await GET(
      new Request("http://localhost/api/packages", {
        headers: { "x-correlation-id": "corr-get" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("corr-get");
    expect(response.headers.get("Cache-Control")).toBe(antiCache);
  });

  it("devuelve 500 controlado si la fábrica de listado falla", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockListDependencies.mockRejectedValue(new Error("offline"));

    const response = await GET(new Request("http://localhost/api/packages"));

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});

describe("POST /api/packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePackageController.mockResolvedValue({
      handleCreatePackage: mockHandleCreatePackage,
      handleListPackages: vi.fn(),
    });
  });

  it("delega al controlador y devuelve 201 en creación exitosa", async () => {
    mockHandleCreatePackage.mockResolvedValue(
      Response.json({ capacityM2: 50, id: "pkg-1", spaceType: "salonSocial" }, { status: 201 }),
    );

    const req = new Request("http://localhost/api/packages", {
      body: JSON.stringify({ capacityM2: 50, spaceType: "salonSocial" }),
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ capacityM2: 50, id: "pkg-1", spaceType: "salonSocial" });
  });

  it("devuelve 500 con error controlado si ocurre excepción inesperada", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleCreatePackage.mockRejectedValue(new Error("Database offline"));

    const req = new Request("http://localhost/api/packages", {
      body: JSON.stringify({ capacityM2: 50, spaceType: "salonSocial" }),
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});
