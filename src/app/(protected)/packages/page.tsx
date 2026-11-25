import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Image from "next/image";

import { signOutAction } from "@/app/actions";
import { createPackageListQueryDependencies } from "@/composition/server";
import { requireSessionUser } from "@/composition/session-guard";
import type { PackageSummary } from "@/modules/packages/application/ports/package-reader.port";

import { FlowSteps } from "../_flow/flow-steps";
import { Icon } from "../_ui/icon";
import { resolvePackagesMode } from "./_lib/packages-client";
import { AccountMenu } from "./account-menu";
import { EventHistory } from "./event-history";
import { NewEventSheet } from "./new-event-sheet";
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

  const eventCount = history?.status === "ready" ? history.packages.length : null;

  return (
    <main className="packages-page events-home">
      <header className="events-topbar">
        <Image alt="DecorAR" className="events-logo" height={240} priority src="/landing/logo.webp" width={242} />
        <AccountMenu email={user.email ?? ""} signOutAction={signOutAction} />
      </header>

      {logoutFailed ? (
        <p className="auth-error" role="alert">
          No pudimos cerrar tu sesión. Inténtalo de nuevo.
        </p>
      ) : null}

      <section aria-labelledby="events-home-title" className="events-hero">
        <h1 className="events-title" id="events-home-title">
          Tus eventos
        </h1>
        <p className="page-lead">
          Crea un evento y decóralo paso a paso: elementos, montaje 3D y cotización. Cliente, fecha y lugar pueden
          completarse después.
        </p>
        <NewEventSheet />
        {/* Recorrido V2 (DECOR-49): el primer paso es crear o abrir un evento. */}
        <FlowSteps current="evento" />
      </section>

      <div className="packages-layout">
        <section aria-labelledby="events-title" className="package-history events-history">
          <div className="section-header">
            <h2 className="section-title" id="events-title">
              Eventos
            </h2>
            {eventCount ? <span className="events-count">{eventCount}</span> : null}
          </div>

          {history === null ? (
            <p className="package-history-empty">El historial persistente está disponible en modo live.</p>
          ) : null}

          {history?.status === "error" ? (
            <p className="auth-error" role="alert">No pudimos cargar tus eventos. Intenta de nuevo.</p>
          ) : null}

          {history?.status === "ready" && history.packages.length === 0 ? (
            <div className="events-empty">
              <span aria-hidden="true" className="events-empty-icon">
                <Icon name="calendar" size={28} />
              </span>
              <p className="events-empty-title">Aún no tienes eventos.</p>
              <p className="events-empty-text">Crea el primero y empieza a decorarlo.</p>
              <NewEventSheet label="Crear tu primer evento" variant="secondary" />
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
