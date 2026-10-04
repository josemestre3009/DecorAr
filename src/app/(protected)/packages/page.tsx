import type { Metadata } from "next";

import { signOutAction } from "@/app/actions";
import { requireSessionUser } from "@/composition/session-guard";

export const metadata: Metadata = {
  title: "Paquetes · DecorAR",
};

type PackagesPageProps = {
  readonly searchParams: Promise<{ readonly logout?: string | string[] }>;
};

export default async function PackagesPage({ searchParams }: PackagesPageProps) {
  // Esta llamada es la verificación efectiva: el layout no se ejecuta en la
  // navegación del cliente. En una carga completa comparte con él una sola
  // llamada getUser() gracias a cache().
  const user = await requireSessionUser();

  const { logout } = await searchParams;
  const logoutFailed = logout === "error";

  return (
    <main className="auth-page">
      <section className="auth">
        <h1 className="auth-title">Paquetes</h1>

        {logoutFailed ? (
          <p className="auth-error" role="alert">
            No pudimos cerrar tu sesión. Inténtalo de nuevo.
          </p>
        ) : null}

        <p className="auth-notice">Sesión activa: {user.email}</p>

        <form action={signOutAction}>
          <button className="auth-submit" type="submit">
            Cerrar sesión
          </button>
        </form>
      </section>
    </main>
  );
}
