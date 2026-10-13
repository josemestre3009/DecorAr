import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleRemoveItem = vi.fn();
const mockHandleMoveItem = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleMoveItem: mockHandleMoveItem,
    handleRemoveItem: mockHandleRemoveItem,
  })),
}));

import { DELETE, PATCH } from "./route";

describe("DELETE /api/packages/[packageId]/items/[itemId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae id y itemId y delega a handleRemoveItem", async () => {
    mockHandleRemoveItem.mockResolvedValue(new Response(null, { status: 204 }));

    const req = new Request("http://localhost/api/packages/pkg-42/items/item-99", {
      method: "DELETE",
    });

    const res = await DELETE(req, {
      params: Promise.resolve({ packageId: "pkg-42", itemId: "item-99" }),
    });
    expect(res.status).toBe(204);
    expect(mockHandleRemoveItem).toHaveBeenCalledWith("pkg-42", "item-99", req);
  });

  it("devuelve 500 controlado si el controlador lanza una excepción", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleRemoveItem.mockRejectedValue(new Error("Database failure"));

    const req = new Request("http://localhost/api/packages/pkg-42/items/item-99", {
      method: "DELETE",
    });

    const res = await DELETE(req, {
      params: Promise.resolve({ packageId: "pkg-42", itemId: "item-99" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});

describe("PATCH /api/packages/[packageId]/items/[itemId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae id e itemId y delega a handleMoveItem", async () => {
    mockHandleMoveItem.mockResolvedValue(
      Response.json({ groupId: "g-1", itemId: "item-99", packageVersion: 5 }, { status: 200 }),
    );

    const req = new Request("http://localhost/api/packages/pkg-42/items/item-99", {
      body: JSON.stringify({ expectedVersion: 4, groupId: "g-1" }),
      method: "PATCH",
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ packageId: "pkg-42", itemId: "item-99" }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleMoveItem).toHaveBeenCalledWith(req, "pkg-42", "item-99");
    expect(await res.json()).toEqual({ groupId: "g-1", itemId: "item-99", packageVersion: 5 });
  });

  it("devuelve 500 controlado con correlationId si el controlador lanza", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleMoveItem.mockRejectedValue(new Error("RPC timeout"));

    const req = new Request("http://localhost/api/packages/pkg-42/items/item-99", { method: "PATCH" });

    const res = await PATCH(req, {
      params: Promise.resolve({ packageId: "pkg-42", itemId: "item-99" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(typeof body.correlationId).toBe("string");
    consoleSpy.mockRestore();
  });
});
