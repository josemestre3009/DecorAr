import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandleGet, mockHandleRename, mockHandleDelete, mockCreateController } = vi.hoisted(() => ({
  mockCreateController: vi.fn(),
  mockHandleDelete: vi.fn(),
  mockHandleGet: vi.fn(),
  mockHandleRename: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createEventTemplateController: mockCreateController,
}));

import { DELETE, GET, PATCH } from "./route";

const PARAMS = { params: Promise.resolve({ templateId: "tpl-1" }) };

describe("/api/event-templates/[templateId] routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateController.mockResolvedValue({
      handleDelete: mockHandleDelete,
      handleGet: mockHandleGet,
      handleRename: mockHandleRename,
    });
  });

  it("GET extrae el templateId y delega", async () => {
    mockHandleGet.mockResolvedValue(Response.json({ id: "tpl-1" }));
    const request = new Request("http://localhost/api/event-templates/tpl-1");

    const response = await GET(request, PARAMS);

    expect(response.status).toBe(200);
    expect(mockHandleGet).toHaveBeenCalledWith(request, "tpl-1");
  });

  it("PATCH delega en handleRename", async () => {
    mockHandleRename.mockResolvedValue(Response.json({ id: "tpl-1", name: "Nuevo" }));
    const request = new Request("http://localhost/api/event-templates/tpl-1", {
      body: JSON.stringify({ name: "Nuevo" }),
      method: "PATCH",
    });

    const response = await PATCH(request, PARAMS);

    expect(response.status).toBe(200);
    expect(mockHandleRename).toHaveBeenCalledWith(request, "tpl-1");
  });

  it("DELETE delega en handleDelete", async () => {
    mockHandleDelete.mockResolvedValue(new Response(null, { status: 204 }));
    const request = new Request("http://localhost/api/event-templates/tpl-1", { method: "DELETE" });

    const response = await DELETE(request, PARAMS);

    expect(response.status).toBe(204);
    expect(mockHandleDelete).toHaveBeenCalledWith(request, "tpl-1");
  });

  it("devuelve 500 controlado si el controlador lanza", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockHandleGet.mockRejectedValue(new Error("RPC timeout"));

    const response = await GET(new Request("http://localhost/api/event-templates/tpl-1"), PARAMS);

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});
