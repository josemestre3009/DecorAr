import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleClonePackage = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createPackageController: vi.fn(async () => ({
    handleClonePackage: mockHandleClonePackage,
  })),
}));

import { POST } from "./route";

describe("POST /api/packages/[packageId]/clone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae el packageId y delega a handleClonePackage", async () => {
    mockHandleClonePackage.mockResolvedValue(
      Response.json(
        {
          capacityM2: 50,
          id: "pkg-cloned-1",
          itemCount: 2,
          spaceType: "salonSocial",
          version: 1,
        },
        { status: 201 },
      ),
    );

    const req = new Request("http://localhost/api/packages/pkg-42/clone", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ packageId: "pkg-42" }) });
    expect(res.status).toBe(201);
    expect(mockHandleClonePackage).toHaveBeenCalledWith(req, "pkg-42");
    const body = await res.json();
    expect(body.id).toBe("pkg-cloned-1");
  });

  it("devuelve 500 controlado si el controlador lanza una excepción", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleClonePackage.mockRejectedValue(new Error("RPC timeout"));

    const req = new Request("http://localhost/api/packages/pkg-42/clone", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ packageId: "pkg-42" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});
