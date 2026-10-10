import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleAddItem = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleAddItem: mockHandleAddItem,
  })),
}));

import { POST } from "./route";

describe("POST /api/packages/[id]/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae el id del parámetro y delega a handleAddItem", async () => {
    mockHandleAddItem.mockResolvedValue(
      Response.json({ itemId: "item-123", packageVersion: 2 }, { status: 201 }),
    );

    const req = new Request("http://localhost/api/packages/pkg-42/items", {
      body: JSON.stringify({ moduleId: "mod-1" }),
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pkg-42" }) });
    expect(res.status).toBe(201);
    expect(mockHandleAddItem).toHaveBeenCalledWith(req, "pkg-42");
    const body = await res.json();
    expect(body).toEqual({ itemId: "item-123", packageVersion: 2 });
  });

  it("devuelve 500 controlado si el controlador lanza una excepción", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleAddItem.mockRejectedValue(new Error("RPC timeout"));

    const req = new Request("http://localhost/api/packages/pkg-42/items", {
      body: JSON.stringify({ moduleId: "mod-1" }),
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pkg-42" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});
