import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import type { SessionUser } from "@/shared/domain/session";

import { createSessionDependencies } from "./server";

const LOGIN_PATH = "/login";

/**
 * Identidad de la petición, validada contra el servidor de autenticación con
 * `getUser()`. Se memoriza con `cache()` de React para que el layout y la página
 * que lo consumen compartan una única llamada por navegación, en lugar de una
 * por cada uno.
 */
export const getCurrentSessionUser = cache(async (): Promise<SessionUser | null> => {
  const { auth } = await createSessionDependencies();

  return auth.currentUser();
});

/**
 * Verificación de las páginas protegidas: resuelve la identidad y envía a la
 * pantalla de inicio de sesión cuando no hay sesión válida.
 *
 * `getClaims()` del proxy sólo valida la firma del token, así que un token
 * todavía vigente aunque la sesión se haya cerrado en otro dispositivo puede
 * atravesarlo. Esta comprobación contra `getUser()` es la que cierra ese hueco.
 * Cada página de `(protected)/` debe llamarla: el layout del grupo no se
 * ejecuta en la navegación del cliente. `src/app/route-inventory.test.ts`
 * comprueba esa regla. Las Server Actions que operen en nombre del usuario
 * también deben validar la identidad por su cuenta.
 */
export const requireSessionUser = cache(async (): Promise<SessionUser> => {
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(LOGIN_PATH);
  }

  return user;
});