import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleUpdateGroup = vi.fn();
const mockHandleDeleteGroup = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleDeleteGroup: mockHandleDeleteGroup,
    handleUpdateGroup: mockHandleUpdateGroup,
  })),
}));

import { DELETE, PATCH } from "./route";

const CONTEXT = { params: Promise.resolve({ groupId: "grp-7", packageId: "pkg-42" }) };

describe("/api/packages/[packageId]/groups/[groupId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PATCH extrae packageId y groupId y delega a handleUpdateGroup", async () => {
    mockHandleUpdateGroup.mockResolvedValue(
      Response.json({ groupId: "grp-7", name: "X", packageVersion: 3, parentGroupId: null }, { status: 200 }),
    );

    const req = new Request("http://localhost/api/packages/pkg-42/groups/grp-7", {
      body: JSON.stringify({ expectedVersion: 2, name: "X" }),
      method: "PATCH",
    });

    const res = await PATCH(req, CONTEXT);
    expect(res.status).toBe(200);
    expect(mockHandleUpdateGroup).toHaveBeenCalledWith(req, "pkg-42", "grp-7");
  });

  it("DELETE extrae packageId y groupId y delega a handleDeleteGroup", async () => {
    mockHandleDeleteGroup.mockResolvedValue(
      Response.json({ groupId: "grp-7", packageVersion: 4, strategy: "move_to_root" }, { status: 200 }),
    );

    const req = new Request("http://localhost/api/packages/pkg-42/groups/grp-7", {
      body: JSON.stringify({ expectedVersion: 3, strategy: "move_to_root" }),
      method: "DELETE",
    });

    const res = await DELETE(req, CONTEXT);
    expect(res.status).toBe(200);
    expect(mockHandleDeleteGroup).toHaveBeenCalledWith(req, "pkg-42", "grp-7");
  });

  it.each([
    ["PATCH", mockHandleUpdateGroup, PATCH],
    ["DELETE", mockHandleDeleteGroup, DELETE],
  ])("%s devuelve 500 controlado con correlationId ante excepción", async (_method, handler, routeFn) => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    handler.mockRejectedValue(new Error("RPC timeout"));

    const req = new Request("http://localhost/api/packages/pkg-42/groups/grp-7", { method: "DELETE" });
    const res = await routeFn(req, CONTEXT);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(typeof body.correlationId).toBe("string");
    consoleSpy.mockRestore();
  });
});
