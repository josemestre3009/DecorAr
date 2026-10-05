import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHandleGetModules = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createCatalogController: vi.fn(async () => ({
    handleGetModules: mockHandleGetModules,
  })),
}));

import { createCatalogController } from "@/composition/server";
import { GET } from "./route";

describe("GET /api/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with camelCase modules array from controller", async () => {
    const expectedModules = [
      {
        id: "c1000000-0000-4000-8000-000000000001",
        name: "Mesa redonda",
        priceCop: 250000,
        areaM2: 4,
        widthM: 2,
        heightM: 1,
        depthM: 2,
        glbUrl: "https://example.com/mesa.glb",
        usdzUrl: "https://example.com/mesa.usdz",
        posterUrl: "https://example.com/mesa.webp",
        assetId: "mesa",
        version: 1,
      },
    ];

    mockHandleGetModules.mockResolvedValue(Response.json(expectedModules, { status: 200 }));

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(expectedModules);
  });

  it("returns 500 controlled response without leaking sensitive details", async () => {
    mockHandleGetModules.mockResolvedValue(
      Response.json(
        {
          error: "Internal Server Error",
          correlationId: "test-correlation-id-1234",
        },
        { status: 500 },
      ),
    );

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "Internal Server Error",
      correlationId: "test-correlation-id-1234",
    });
    expect(body).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(body).not.toHaveProperty("stack");
  });

  it("returns 500 controlled response when createCatalogController fails during initialization", async () => {
    vi.mocked(createCatalogController).mockRejectedValueOnce(
      new Error("Supabase initialization error: missing environment variables"),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "Internal Server Error",
      correlationId: expect.any(String),
    });
    expect(body.correlationId.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("stack");
    expect(body).not.toHaveProperty("message");

    consoleSpy.mockRestore();
  });
});
