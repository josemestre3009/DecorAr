import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandleInstantiate, mockCreateController } = vi.hoisted(() => ({
  mockCreateController: vi.fn(),
  mockHandleInstantiate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createEventTemplateController: mockCreateController,
}));

import { POST } from "./route";

const PARAMS = { params: Promise.resolve({ templateId: "tpl-1" }) };

describe("POST /api/event-templates/[templateId]/instantiate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateController.mockResolvedValue({ handleInstantiate: mockHandleInstantiate });
  });

  it("extrae el templateId y delega en handleInstantiate", async () => {
    mockHandleInstantiate.mockResolvedValue(Response.json({ id: "pkg-new" }, { status: 201 }));
    const request = new Request("http://localhost/api/event-templates/tpl-1/instantiate", {
      body: JSON.stringify({ name: "Nuevo evento" }),
      method: "POST",
    });

    const response = await POST(request, PARAMS);

    expect(response.status).toBe(201);
    expect(mockHandleInstantiate).toHaveBeenCalledWith(request, "tpl-1");
  });

  it("devuelve 500 controlado si el controlador lanza", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleInstantiate.mockRejectedValue(new Error("RPC timeout"));

    const response = await POST(
      new Request("http://localhost/api/event-templates/tpl-1/instantiate", { method: "POST" }),
      PARAMS,
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});
