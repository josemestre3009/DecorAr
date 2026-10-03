import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseEnv } from "./lib/env";

const LOGIN_PATH = "/login";
const PROTECTED_PAGE_PREFIXES = ["/packages"];

function isProtectedPage(pathname: string): boolean {
  // Las rutas de API nunca se redirigen aquí: las validan sus Route Handlers,
  // que responden 401 en JSON en lugar de devolver una redirección.
  if (pathname.startsWith("/api/")) {
    return false;
  }

  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function applyHeaders(response: NextResponse, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}

export async function proxy(request: NextRequest) {
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

  if (isAuthenticated || !isProtectedPage(pathname)) {
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
