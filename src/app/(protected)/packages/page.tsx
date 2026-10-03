import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signOutAction } from "@/app/actions";
import { createSessionDependencies } from "@/composition/server";

export const metadata: Metadata = {
  title: "Paquetes · DecorAR",
};

type PackagesPageProps = {
  readonly searchParams: Promise<{ readonly logout?: string | string[] }>;
};

export default async function PackagesPage({ searchParams }: PackagesPageProps) {
  const { auth } = await createSessionDependencies();
  const user = await auth.currentUser();

  // El proxy ya redirige a /login; esta comprobación evita depender sólo de él.
  if (!user) {
    redirect("/login");
  }

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
