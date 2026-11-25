import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleGet = vi.fn();
const mockHandlePut = vi.fn();

vi.mock("server-only", () => ({}));
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/composition/server", () => ({
  serverLogger: mockLogger,
  createSceneController: vi.fn(async () => ({
    handleGet: mockHandleGet,
    handlePut: mockHandlePut,
  })),
}));

import { GET, PUT } from "./route";

describe("GET /api/packages/[packageId]/scene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae packageId y delega a handleGet", async () => {
    mockHandleGet.mockResolvedValue(
      Response.json({ sceneVersion: 2, transforms: [] }, { status: 200 }),
    );

    const req = new Request("http://localhost/api/packages/pkg-42/scene");

    const res = await GET(req, { params: Promise.resolve({ packageId: "pkg-42" }) });

    expect(res.status).toBe(200);
    expect(mockHandleGet).toHaveBeenCalledWith(req, "pkg-42");
    expect(await res.json()).toEqual({ sceneVersion: 2, transforms: [] });
  });

  it("devuelve 500 controlado con correlationId si el controlador lanza", async () => {
    mockHandleGet.mockRejectedValue(new Error("Database failure"));

    const req = new Request("http://localhost/api/packages/pkg-42/scene");

    const res = await GET(req, { params: Promise.resolve({ packageId: "pkg-42" }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(typeof body.correlationId).toBe("string");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "route.uncaught_error",
      expect.objectContaining({ correlationId: body.correlationId }),
    );
  });
});

describe("PUT /api/packages/[packageId]/scene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrae packageId y delega a handlePut", async () => {
    mockHandlePut.mockResolvedValue(Response.json({ sceneVersion: 3 }, { status: 200 }));

    const req = new Request("http://localhost/api/packages/pkg-42/scene", {
      body: JSON.stringify({ expectedSceneVersion: 2, transforms: [] }),
      method: "PUT",
    });

    const res = await PUT(req, { params: Promise.resolve({ packageId: "pkg-42" }) });

    expect(res.status).toBe(200);
    expect(mockHandlePut).toHaveBeenCalledWith(req, "pkg-42");
    expect(await res.json()).toEqual({ sceneVersion: 3 });
  });

  it("devuelve 500 controlado con correlationId si el controlador lanza", async () => {
    mockHandlePut.mockRejectedValue(new Error("RPC timeout"));

    const req = new Request("http://localhost/api/packages/pkg-42/scene", { method: "PUT" });

    const res = await PUT(req, { params: Promise.resolve({ packageId: "pkg-42" }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(typeof body.correlationId).toBe("string");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "route.uncaught_error",
      expect.objectContaining({ correlationId: body.correlationId }),
    );
  });
});
