import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandler, mockCreateController } = vi.hoisted(() => ({
  mockCreateController: vi.fn(),
  mockHandler: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createQuoteController: mockCreateController,
}));

import { GET } from "./route";

describe("GET /api/quotes/q-1 (DECOR-50)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateController.mockResolvedValue({ handleGet: mockHandler });
  });

  it("delega en QuoteController.handleGet", async () => {
    mockHandler.mockResolvedValue(Response.json({ ok: true }));
    const request = new Request("http://localhost/api/quotes/q-1", { method: "GET" });

    const response = await GET(request, { params: Promise.resolve({ quoteId: "q-1" }) });

    expect(response.status).toBe(200);
    expect(mockHandler).toHaveBeenCalledWith(request, "q-1");
  });

  it("un error no controlado devuelve 500 internal_error con correlationId", async () => {
    mockCreateController.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("http://localhost/api/quotes/q-1", { method: "GET" });

    const response = await GET(request, { params: Promise.resolve({ quoteId: "q-1" }) });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(typeof body.correlationId).toBe("string");
    spy.mockRestore();
  });
});
