import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleRemoveItem = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleRemoveItem: mockHandleRemoveItem,
  })),
}));

import { DELETE } from "./route";

describe("DELETE /api/packages/[id]/items/[itemId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae id y itemId y delega a handleRemoveItem", async () => {
    mockHandleRemoveItem.mockResolvedValue(new Response(null, { status: 204 }));

    const req = new Request("http://localhost/api/packages/pkg-42/items/item-99", {
      method: "DELETE",
    });

    const res = await DELETE(req, {
      params: Promise.resolve({ id: "pkg-42", itemId: "item-99" }),
    });
    expect(res.status).toBe(204);
    expect(mockHandleRemoveItem).toHaveBeenCalledWith("pkg-42", "item-99");
  });

  it("devuelve 500 controlado si el controlador lanza una excepción", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleRemoveItem.mockRejectedValue(new Error("Database failure"));

    const req = new Request("http://localhost/api/packages/pkg-42/items/item-99", {
      method: "DELETE",
    });

    const res = await DELETE(req, {
      params: Promise.resolve({ id: "pkg-42", itemId: "item-99" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});
