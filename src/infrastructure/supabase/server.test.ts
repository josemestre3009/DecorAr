import { beforeEach, describe, expect, it, vi } from "vitest";

const { captured, cookieStore } = vi.hoisted(() => ({
  captured: { options: undefined as { cookies?: Record<string, unknown> } | undefined },
  cookieStore: {
    getAll: vi.fn((): { name: string; value: string }[] => []),
    set: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: unknown) => {
    captured.options = options as { cookies?: Record<string, unknown> };

    return { auth: {} };
  }),
}));

const originalEnv = { ...process.env };

const ANTI_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  "Pragma": "no-cache",
};

function getSetAll() {
  return captured.options?.cookies?.setAll as (
    cookies: unknown[],
    headers: Record<string, string>,
  ) => Promise<void>;
}

async function invokeSetAll() {
  await getSetAll()([{ name: "sb-token", value: "nuevo", options: { path: "/" } }], ANTI_CACHE_HEADERS);
}

async function createWith(onHeaders?: (headers: Record<string, string>) => void) {
  const { createClient } = await import("./server");
  const client = await createClient(onHeaders ? { onHeaders } : {});
  expect(client).toBeDefined();

  return client;
}

describe("cliente de sesión server-side", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example";
    captured.options = undefined;
    cookieStore.set.mockReset();
    vi.clearAllMocks();
  });

  it("propaga al consumidor los encabezados anti-caché de la librería", async () => {
    const onHeaders = vi.fn();
    await createWith(onHeaders);

    await invokeSetAll();

    expect(onHeaders).toHaveBeenCalledWith(ANTI_CACHE_HEADERS);
  });

  it("escribe las cookies de sesión en el almacén del framework", async () => {
    await createWith();

    await invokeSetAll();

    expect(cookieStore.set).toHaveBeenCalledWith("sb-token", "nuevo", { path: "/" });
  });

  it("no falla cuando el almacén de cookies es de sólo lectura", async () => {
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
    });

    const onHeaders = vi.fn();
    await createWith(onHeaders);

    await expect(invokeSetAll()).resolves.toBeUndefined();
    expect(onHeaders).toHaveBeenCalledWith(ANTI_CACHE_HEADERS);
  });

  it("sí propaga un fallo del almacén que no es de sólo lectura", async () => {
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Fallo de almacenamiento no relacionado con lectura");
    });

    await createWith();

    await expect(invokeSetAll()).rejects.toThrow("Fallo de almacenamiento no relacionado con lectura");
  });

  it("funciona sin onHeaders y descarta los encabezados", async () => {
    await createWith();

    await expect(invokeSetAll()).resolves.toBeUndefined();
  });
});
