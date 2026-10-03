import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, depsMock, redirectMock } = vi.hoisted(() => {
  const auth = { currentUser: vi.fn() };

  return {
    authMock: auth,
    depsMock: vi.fn(async () => ({ auth })),
    redirectMock: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("./server", () => ({ createSessionDependencies: depsMock }));
vi.mock("server-only", () => ({}));

const { getCurrentSessionUser, requireSessionUser } = await import("./session-guard");

const user = { email: "persona@example.com", id: "user-1" };

describe("frontera de sesión", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve la identidad cuando la sesión es válida", async () => {
    authMock.currentUser.mockResolvedValue(user);

    await expect(getCurrentSessionUser()).resolves.toEqual(user);
    await expect(requireSessionUser()).resolves.toEqual(user);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("devuelve null sin sesión en lugar de lanzar", async () => {
    authMock.currentUser.mockResolvedValue(null);

    await expect(getCurrentSessionUser()).resolves.toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("envía al login cuando la sesión se cerró en otro dispositivo", async () => {
    authMock.currentUser.mockResolvedValue(null);

    await requireSessionUser();

    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("lee la identidad a través de la composición, sin tocar el cliente de Supabase", async () => {
    authMock.currentUser.mockResolvedValue(user);

    await requireSessionUser();

    const dependencias = await depsMock.mock.results[0].value;

    expect(depsMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(dependencias)).toEqual(["auth"]);
  });
});