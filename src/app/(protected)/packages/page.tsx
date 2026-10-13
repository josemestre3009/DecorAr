import { randomUUID } from "node:crypto";

import type { Metadata } from "next";

import { signOutAction } from "@/app/actions";
import { createPackageListQueryDependencies } from "@/composition/server";
import { requireSessionUser } from "@/composition/session-guard";
import type { PackageSummary } from "@/modules/packages/application/ports/package-reader.port";

import { resolvePackagesMode } from "./_lib/packages-client";
import { EventHistory } from "./event-history";
import { EventForm } from "./event-form";
import { TemplateManager } from "./template-manager";

export const metadata: Metadata = {
  title: "Eventos · DecorAR",
};

type PackagesPageProps = {
  readonly searchParams: Promise<{ readonly logout?: string | string[] }>;
};

type PackageHistory =
  | { readonly status: "ready"; readonly packages: readonly PackageSummary[] }
  | { readonly status: "error" };

export async function loadPackageHistory(userId: string): Promise<PackageHistory> {
  const { listOwnedPackages } = await createPackageListQueryDependencies();
  const result = await listOwnedPackages.execute(userId);

  if (!result.ok) {
    console.error(`[PackagesPage] No se pudieron leer los eventos (${randomUUID()}):`, result.error.code);
    return { status: "error" };
  }

  return { packages: result.value, status: "ready" };
}

export default async function PackagesPage({ searchParams }: PackagesPageProps) {
  // Esta llamada es la verificación efectiva: el layout no se ejecuta en la
  // navegación del cliente. En una carga completa comparte con él una sola
  // llamada getUser() gracias a cache().
  const user = await requireSessionUser();
  const isLive = resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) === "live";
  const history = isLive ? await loadPackageHistory(user.id) : null;

  const { logout } = await searchParams;
  const logoutFailed = logout === "error";

  return (
    <main className="packages-page">
      <div className="packages-layout">
        <section className="auth packages-create">
          <h1 className="auth-title">Organiza tus eventos</h1>

          {logoutFailed ? (
            <p className="auth-error" role="alert">
              No pudimos cerrar tu sesión. Inténtalo de nuevo.
            </p>
          ) : null}

          <p className="page-lead">
            Crea un evento con su nombre. Cliente, fecha, lugar y área pueden completarse
            después, al configurar la decoración.
          </p>

          <EventForm />

          <div className="session-bar">
            <p className="auth-notice">Sesión activa: {user.email}</p>

            <form action={signOutAction}>
              <button className="secondary-button" type="submit">
                Cerrar sesión
              </button>
            </form>
          </div>
        </section>

        <section aria-labelledby="events-title" className="package-history events-history">
            <div>
              <h2 className="section-title" id="events-title">
                Eventos
              </h2>
            </div>

            {history === null ? (
              <p className="package-history-empty">El historial persistente está disponible en modo live.</p>
            ) : null}

            {history?.status === "error" ? (
              <p className="auth-error" role="alert">No pudimos cargar tus eventos. Intenta de nuevo.</p>
            ) : null}

            {history?.status === "ready" && history.packages.length === 0 ? (
              <div className="package-history-empty">
                <p>Aún no tienes eventos.</p>
                <p>Crea el primero con el formulario.</p>
              </div>
            ) : null}

            {history?.status === "ready" && history.packages.length > 0 ? (
              <EventHistory packages={history.packages} />
            ) : null}
        </section>

        <TemplateManager />
      </div>
    </main>
  );
}
