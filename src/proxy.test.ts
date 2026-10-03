import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captured, sessionState, antiCacheHeaders } = vi.hoisted(() => {
  const headers = {
    "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
    Expires: "0",
    "Pragma": "no-cache",
  };

  return {
    antiCacheHeaders: headers,
    captured: { options: undefined as { cookies?: Record<string, unknown> } | undefined },
    sessionState: { claims: null as { sub?: string } | null },
  };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: unknown) => {
    captured.options = options as { cookies?: Record<string, unknown> };

    const setAll = (options as { cookies: { setAll: unknown } }).cookies.setAll as (
      cookies: unknown[],
      headers: Record<string, string>,
    ) => void;

    return {
      auth: {
        // La librería escribe cookies cuando refresca el token durante la
        // inicialización perezosa, así que el doble reproduce ese momento.
        getClaims: vi.fn(async () => {
          setAll(
            [{ name: "sb-project-auth-token", value: "refrescado", options: { path: "/" } }],
            antiCacheHeaders,
          );

          return { data: { claims: sessionState.claims }, error: null };
        }),
      },
    };
  }),
}));

const { proxy } = await import("./proxy");

function request(pathname: string) {
  return new NextRequest(`http://localhost:3000${pathname}`);
}

describe("proxy de sesión", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example";
    sessionState.claims = null;
    captured.options = undefined;
    vi.clearAllMocks();
  });

  it("deja pasar las rutas públicas sin sesión", async () => {
    const response = await proxy(request("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("deja pasar la portada sin sesión", async () => {
    const response = await proxy(request("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirige a /login cuando una ruta protegida se abre sin sesión", async () => {
    const response = await proxy(request("/packages"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("redirige también las subrutas del catálogo", async () => {
    const response = await proxy(request("/packages/12"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  // Rutas que traen DECOR-18, DECOR-19 y DECOR-20. Ninguna está en la lista de
  // rutas públicas, así que nacen protegidas sin tocar el proxy.
  it.each(["/catalog", "/configurador", "/ar"])(
    "redirige %s a /login aunque todavía no exista la página",
    async (pathname) => {
      const response = await proxy(request(pathname));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    },
  );

  it("no confunde un prefijo público con uno que sólo lo empieza", async () => {
    const response = await proxy(request("/login-helper"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("deja pasar una ruta protegida cuando la sesión es válida", async () => {
    sessionState.claims = { sub: "user-1" };

    const response = await proxy(request("/packages"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("no redirige las rutas de API porque las validan sus handlers", async () => {
    const response = await proxy(request("/api/session"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("escribe en la petición las cookies que la librería refrescó", async () => {
    const nextRequest = request("/packages");
    await proxy(nextRequest);

    const getAll = captured.options?.cookies?.getAll as () => { name: string; value: string }[];

    expect(getAll()).toContainEqual(
      expect.objectContaining({ name: "sb-project-auth-token", value: "refrescado" }),
    );
  });

  it("aplica los encabezados anti-caché a la respuesta continua", async () => {
    sessionState.claims = { sub: "user-1" };

    const response = await proxy(request("/packages"));

    expect(response.headers.get("Cache-Control")).toBe(antiCacheHeaders["Cache-Control"]);
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refrescado");
  });

  it("conserva las cookies y los encabezados en la redirección al login", async () => {
    const response = await proxy(request("/packages"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(response.headers.get("Cache-Control")).toBe(antiCacheHeaders["Cache-Control"]);
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refrescado");
  });

  it("descarta la query original al redirigir para no reenviar datos al login", async () => {
    const response = await proxy(request("/packages?token=secreto"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
