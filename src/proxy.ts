import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseEnv } from "./lib/env";

const LOGIN_PATH = "/login";

// Se declara lo público, no lo protegido: una página nueva nace protegida y sólo
// queda accesible sin sesión si alguien la añade aquí a propósito. La lista
// complementaria, `/api`, se trata aparte porque no la redirige este archivo.
const PUBLIC_PAGE_PREFIXES = ["/", "/login", "/signup"];

// El healthcheck del contenedor (DECOR-37) no lleva sesión ni debe depender de
// que Supabase esté configurado o responda: se atiende sin crear el cliente.
const HEALTH_PATH = "/api/health";

function isApiRoute(pathname: string): boolean {
  // Las rutas de API nunca se redirigen aquí: las validan sus Route Handlers,
  // que responden 401 en JSON en lugar de devolver una redirección.
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PREFIXES.some((prefix) => {
    // "/" representa la portada, no el sitio entero: si devolviera true para
    // cualquier ruta, el proxy dejaría de proteger nada.
    if (prefix === "/") {
      return pathname === "/";
    }

    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

function applyHeaders(response: NextResponse, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === HEALTH_PATH) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const pendingHeaders: Record<string, string> = {};
  const { url, publishableKey } = getPublicSupabaseEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers ?? {}).forEach(([key, value]) => {
          pendingHeaders[key] = value;
        });
      },
    },
  });

  // No debe ejecutarse código entre createServerClient y esta llamada: un fallo
  // aquí provoca cierres de sesión intermitentes difíciles de depurar.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (isAuthenticated || isApiRoute(pathname) || isPublicPage(pathname)) {
    return applyHeaders(response, pendingHeaders);
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = LOGIN_PATH;
  loginUrl.search = "";

  const redirect = NextResponse.redirect(loginUrl);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));

  return applyHeaders(redirect, pendingHeaders);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
