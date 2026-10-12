import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleRenameGroup = vi.fn();
const mockHandleDeleteGroup = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleDeleteGroup: mockHandleDeleteGroup,
    handleRenameGroup: mockHandleRenameGroup,
  })),
}));

import { DELETE, PATCH } from "./route";

const context = { params: Promise.resolve({ groupId: "grp-7", packageId: "pkg-42" }) };

describe("/api/packages/[packageId]/groups/[groupId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PATCH extrae los ids y delega a handleRenameGroup", async () => {
    mockHandleRenameGroup.mockResolvedValue(
      Response.json({ groupId: "grp-7", name: "Sala", structureVersion: 2 }, { status: 200 }),
    );
    const req = new Request("http://localhost/api/packages/pkg-42/groups/grp-7", {
      body: JSON.stringify({ name: "Sala" }),
      method: "PATCH",
    });

    const res = await PATCH(req, context);

    expect(res.status).toBe(200);
    expect(mockHandleRenameGroup).toHaveBeenCalledWith(req, "pkg-42", "grp-7");
    expect((await res.json()).name).toBe("Sala");
  });

  it("DELETE extrae los ids y delega a handleDeleteGroup", async () => {
    mockHandleDeleteGroup.mockResolvedValue(new Response(null, { status: 204 }));
    const req = new Request("http://localhost/api/packages/pkg-42/groups/grp-7", { method: "DELETE" });

    const res = await DELETE(req, context);

    expect(res.status).toBe(204);
    expect(mockHandleDeleteGroup).toHaveBeenCalledWith(req, "pkg-42", "grp-7");
  });

  it("devuelve 500 controlado con correlationId si el controlador lanza una excepción", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleRenameGroup.mockRejectedValue(new Error("RPC timeout"));
    mockHandleDeleteGroup.mockRejectedValue(new Error("RPC timeout"));
    const url = "http://localhost/api/packages/pkg-42/groups/grp-7";

    for (const res of [
      await PATCH(new Request(url, { method: "PATCH" }), context),
      await DELETE(new Request(url, { method: "DELETE" }), context),
    ]) {
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("internal_error");
      expect(typeof body.correlationId).toBe("string");
    }
    consoleSpy.mockRestore();
  });
});
