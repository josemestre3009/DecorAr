import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleUpdatePackage = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleUpdatePackage: mockHandleUpdatePackage,
  })),
}));

import { PATCH } from "./route";

describe("PATCH /api/packages/[packageId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae el id del parámetro y delega a handleUpdatePackage", async () => {
    mockHandleUpdatePackage.mockResolvedValue(
      Response.json({ id: "pkg-42", name: "Evento" }, { status: 200 }),
    );

    const req = new Request("http://localhost/api/packages/pkg-42", {
      body: JSON.stringify({ name: "Evento" }),
      method: "PATCH",
    });

    const res = await PATCH(req, { params: Promise.resolve({ packageId: "pkg-42" }) });
    expect(res.status).toBe(200);
    expect(mockHandleUpdatePackage).toHaveBeenCalledWith(req, "pkg-42");
    expect(await res.json()).toEqual({ id: "pkg-42", name: "Evento" });
  });

  it("devuelve 500 controlado si el controlador lanza una excepción", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleUpdatePackage.mockRejectedValue(new Error("RPC timeout"));

    const req = new Request("http://localhost/api/packages/pkg-42", {
      body: JSON.stringify({ name: "Evento" }),
      method: "PATCH",
    });

    const res = await PATCH(req, { params: Promise.resolve({ packageId: "pkg-42" }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});
