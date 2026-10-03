import type { ReactNode } from "react";

import { requireSessionUser } from "@/composition/session-guard";

type ProtectedLayoutProps = {
  readonly children: ReactNode;
};

/**
 * Frontera única de las rutas protegidas. `src/proxy.ts` redirige al login a
 * quien no tiene sesión, pero su validación de claims no comprueba que la sesión
 * siga viva en el servidor de autenticación; este layout sí lo hace, con
 * `getUser()` a través del caso de uso.
 *
 * Al vivir aquí, una página nueva que se añada bajo `(protected)/` queda
 * protegida sin tener que repetir la comprobación.
 */
export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  await requireSessionUser();

  return children;
}