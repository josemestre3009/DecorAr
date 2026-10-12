import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleCreatePackage = vi.fn();
const mockHandleListPackages = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleCreatePackage: mockHandleCreatePackage,
    handleListPackages: mockHandleListPackages,
  })),
}));

import { GET, POST } from "./route";

describe("GET /api/packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delega el listado autenticado al controlador", async () => {
    mockHandleListPackages.mockResolvedValue(Response.json({ packages: [] }));
    const request = new Request("http://localhost/api/packages");

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ packages: [] });
    expect(mockHandleListPackages).toHaveBeenCalledWith(request);
  });

  it("devuelve 500 controlado ante una excepción", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleListPackages.mockRejectedValue(new Error("offline"));

    const response = await GET(new Request("http://localhost/api/packages"));

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});

describe("POST /api/packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
