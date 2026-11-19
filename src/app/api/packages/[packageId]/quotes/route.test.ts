import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandler, mockCreateController } = vi.hoisted(() => ({
  mockCreateController: vi.fn(),
  mockHandler: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createQuoteController: mockCreateController,
}));

import { POST } from "./route";

describe("POST /api/packages/pkg-1/quotes (DECOR-50)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateController.mockResolvedValue({ handleCreate: mockHandler });
  });

  it("delega en QuoteController.handleCreate", async () => {
    mockHandler.mockResolvedValue(Response.json({ ok: true }));
    const request = new Request("http://localhost/api/packages/pkg-1/quotes", { method: "POST" });

    const response = await POST(request, { params: Promise.resolve({ packageId: "pkg-1" }) });

    expect(response.status).toBe(200);
    expect(mockHandler).toHaveBeenCalledWith(request, "pkg-1");
  });

  it("un error no controlado devuelve 500 internal_error con correlationId", async () => {
    mockCreateController.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("http://localhost/api/packages/pkg-1/quotes", { method: "POST" });

    const response = await POST(request, { params: Promise.resolve({ packageId: "pkg-1" }) });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(typeof body.correlationId).toBe("string");
    spy.mockRestore();
  });
});
