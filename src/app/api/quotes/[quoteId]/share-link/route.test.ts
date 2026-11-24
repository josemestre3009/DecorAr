import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandlers, mockCreateController } = vi.hoisted(() => ({
  mockCreateController: vi.fn(),
  mockHandlers: { handleCreate: vi.fn(), handleGet: vi.fn(), handleRevoke: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createQuoteShareLinkController: mockCreateController,
}));

import { DELETE, GET, POST } from "./route";

describe("rutas /api/quotes/q-1/share-link (DECOR-53)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateController.mockResolvedValue(mockHandlers);
  });

  it("POST delega en QuoteShareLinkController.handleCreate", async () => {
    mockHandlers.handleCreate.mockResolvedValue(Response.json({ ok: true }, { status: 201 }));
    const request = new Request("http://localhost/api/quotes/q-1/share-link", { method: "POST" });

    const response = await POST(request, { params: Promise.resolve({ quoteId: "q-1" }) });

    expect(response.status).toBe(201);
    expect(mockHandlers.handleCreate).toHaveBeenCalledWith(request, "q-1");
  });

  it("GET delega en QuoteShareLinkController.handleGet", async () => {
    mockHandlers.handleGet.mockResolvedValue(Response.json({ link: null }));
    const request = new Request("http://localhost/api/quotes/q-1/share-link");

    const response = await GET(request, { params: Promise.resolve({ quoteId: "q-1" }) });

    expect(response.status).toBe(200);
    expect(mockHandlers.handleGet).toHaveBeenCalledWith(request, "q-1");
  });

  it("DELETE delega en QuoteShareLinkController.handleRevoke", async () => {
    mockHandlers.handleRevoke.mockResolvedValue(Response.json({ ok: true }));
    const request = new Request("http://localhost/api/quotes/q-1/share-link", { method: "DELETE" });

    const response = await DELETE(request, { params: Promise.resolve({ quoteId: "q-1" }) });

    expect(response.status).toBe(200);
    expect(mockHandlers.handleRevoke).toHaveBeenCalledWith(request, "q-1");
  });

  it("un error no controlado devuelve 500 internal_error con correlationId", async () => {
    mockCreateController.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("http://localhost/api/quotes/q-1/share-link", { method: "POST" });

    const response = await POST(request, { params: Promise.resolve({ quoteId: "q-1" }) });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(typeof body.correlationId).toBe("string");
    spy.mockRestore();
  });
});
