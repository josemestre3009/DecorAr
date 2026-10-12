import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { signOutAction } from "@/app/actions";
import { createPackageListQueryDependencies } from "@/composition/server";
import { requireSessionUser } from "@/composition/session-guard";
import type { PackageSummary } from "@/modules/packages/application/ports/package-reader.port";

import { resolvePackagesMode } from "./_lib/packages-client";
import { SpaceForm } from "./space-form";

export const metadata: Metadata = {
  title: "Paquetes · DecorAR",
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
    console.error(`[PackagesPage] No se pudieron leer los paquetes (${randomUUID()}):`, result.error.code);
    return { status: "error" };
  }

  return { packages: result.value, status: "ready" };
}

const SPACE_LABELS = {
  aireLibre: "Aire libre",
  casa: "Casa",
  salonSocial: "Salón social",
} as const;

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
        <h1 className="auth-title">Define tu espacio</h1>

        {logoutFailed ? (
          <p className="auth-error" role="alert">
            No pudimos cerrar tu sesión. Inténtalo de nuevo.
          </p>
        ) : null}

        <p className="page-lead">
          Cuéntanos dónde será el evento y cuántos metros cuadrados tienes. Con eso
          creamos tu paquete y te mostramos el catálogo.
        </p>

        <SpaceForm />

        <div className="session-bar">
          <p className="auth-notice">Sesión activa: {user.email}</p>

          <form action={signOutAction}>
            <button className="secondary-button" type="submit">
              Cerrar sesión
            </button>
          </form>
        </div>
      </section>
      <section aria-labelledby="package-history-title" className="package-history">
        <div>
          <p className="package-history-kicker">Tu historial</p>
          <h2 className="section-title" id="package-history-title">Mis paquetes</h2>
        </div>

        {history === null ? (
          <p className="package-history-empty">El historial persistente está disponible en modo live.</p>
        ) : null}

        {history?.status === "error" ? (
          <p className="auth-error" role="alert">No pudimos cargar tus paquetes. Intenta de nuevo.</p>
        ) : null}

        {history?.status === "ready" && history.packages.length === 0 ? (
          <div className="package-history-empty">
            <p>Aún no tienes paquetes.</p>
            <p>Crea el primero con el formulario.</p>
          </div>
        ) : null}

        {history?.status === "ready" && history.packages.length > 0 ? (
          <ul className="package-history-list">
            {history.packages.map((pkg) => (
              <li className="package-history-card" key={pkg.id}>
                <div>
                  <h3>{pkg.spaceType ? SPACE_LABELS[pkg.spaceType] : "Espacio sin definir"}</h3>
                  <p>{pkg.capacityM2 === null ? "Capacidad sin definir" : `${pkg.capacityM2} m²`}</p>
                </div>
                <p className="package-history-date">
                  Actualizado el {new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(new Date(pkg.updatedAt))}
                </p>
                <Link
                  aria-label={`Continuar con ${pkg.spaceType ? SPACE_LABELS[pkg.spaceType] : "espacio sin definir"}, paquete ${pkg.id}`}
                  className="secondary-button package-history-link"
                  href={`/packages/${pkg.id}`}
                >
                  Continuar
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      </div>
    </main>
  );
}
