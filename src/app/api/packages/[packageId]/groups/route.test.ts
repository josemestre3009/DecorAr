import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleCreateGroup = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleCreateGroup: mockHandleCreateGroup,
  })),
}));

import { POST } from "./route";

describe("POST /api/packages/[packageId]/groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae el packageId y delega a handleCreateGroup", async () => {
    mockHandleCreateGroup.mockResolvedValue(
      Response.json(
        { depth: 1, groupId: "grp-1", itemIds: ["a", "b"], name: "Zona de bienvenida", packageVersion: 3, parentGroupId: null },
        { status: 201 },
      ),
    );

    const req = new Request("http://localhost/api/packages/pkg-42/groups", {
      body: JSON.stringify({ name: "Zona de bienvenida" }),
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ packageId: "pkg-42" }) });
    expect(res.status).toBe(201);
    expect(mockHandleCreateGroup).toHaveBeenCalledWith(req, "pkg-42");
    expect((await res.json()).groupId).toBe("grp-1");
  });

  it("devuelve 500 controlado con correlationId si el controlador lanza una excepción", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleCreateGroup.mockRejectedValue(new Error("RPC timeout"));

    const req = new Request("http://localhost/api/packages/pkg-42/groups", { method: "POST" });

    const res = await POST(req, { params: Promise.resolve({ packageId: "pkg-42" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(typeof body.correlationId).toBe("string");
    consoleSpy.mockRestore();
  });
});
