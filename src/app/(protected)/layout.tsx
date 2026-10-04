import type { ReactNode } from "react";

import { requireSessionUser } from "@/composition/session-guard";

type ProtectedLayoutProps = {
  readonly children: ReactNode;
};

/**
 * Revalida la identidad en las navegaciones completas del grupo `(protected)`.
 *
 * No es la frontera de autorización: en Next 16 los layouts no se vuelven a
 * ejecutar en la navegación del cliente y no impiden que la página se ejecute
 * (guía de autenticación, "Layouts and auth checks"). Por eso cada página
 * protegida llama también a `requireSessionUser()`, y
 * `src/app/route-inventory.test.ts` falla si alguna lo omite.
 */
export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  await requireSessionUser();

  return children;
}