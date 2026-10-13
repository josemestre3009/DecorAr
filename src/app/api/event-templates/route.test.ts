import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandleList, mockHandleCreate, mockCreateController } = vi.hoisted(() => ({
  mockCreateController: vi.fn(),
  mockHandleCreate: vi.fn(),
  mockHandleList: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/composition/server", () => ({
  createEventTemplateController: mockCreateController,
}));

import { GET, POST } from "./route";

describe("/api/event-templates routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateController.mockResolvedValue({
      handleCreate: mockHandleCreate,
      handleList: mockHandleList,
    });
  });

  it("GET delega en handleList", async () => {
    mockHandleList.mockResolvedValue(Response.json({ templates: [] }));

    const response = await GET(new Request("http://localhost/api/event-templates"));

    expect(response.status).toBe(200);
    expect(mockHandleList).toHaveBeenCalledTimes(1);
  });

  it("POST delega en handleCreate", async () => {
    mockHandleCreate.mockResolvedValue(Response.json({ id: "tpl-1" }, { status: 201 }));

    const request = new Request("http://localhost/api/event-templates", {
      body: JSON.stringify({ name: "X", packageId: "pkg-1" }),
      method: "POST",
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockHandleCreate).toHaveBeenCalledWith(request);
  });

  it("devuelve 500 controlado cuando la composición falla", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateController.mockRejectedValue(new Error("missing service role key"));

    const response = await GET(new Request("http://localhost/api/event-templates"));

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
    consoleSpy.mockRestore();
  });
});
