import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { PackageDetailView } from "@/modules/packages/application/dtos/package-detail.dto";
import { createPackageQueryDependencies } from "@/composition/server";
import { requireSessionUser } from "@/composition/session-guard";

import { countUnitsByModule, type ConfiguratorBudget } from "../_lib/configurator-view";
import { resolvePackagesMode } from "../_lib/packages-client";
import { BudgetTotal } from "./budget-total";
import { DuplicatePackageButton } from "./duplicate-package-button";
import { PackageCatalog } from "./package-catalog";
import { PackageContents } from "./package-contents";
import { PageHeading } from "./page-heading";
import { RefreshButton } from "./refresh-button";
import { SpaceSummary } from "./space-summary";
import { WelcomeZoneButton } from "./welcome-zone-button";

export const metadata: Metadata = {
  title: "Tu paquete · DecorAR",
};

type PackagePageProps = {
  readonly params: Promise<{ readonly packageId: string }>;
};

type Configurator =
  | { readonly status: "ready"; readonly detail: PackageDetailView; readonly budget: ConfiguratorBudget }
  | { readonly status: "error" };

/**
 * Configurador (DECOR-22): lee el paquete y el total confirmado en el servidor.
 * Un paquete ajeno o inexistente responde 404 sin revelar que existe. Después
 * de agregar, quitar o duplicar, los componentes cliente hacen
 * `router.refresh()` y esta lectura se repite.
 */
export async function loadConfigurator(packageId: string): Promise<Configurator> {
  const { authorizePackageAccess, getBudget, getPackageDetail } = await createPackageQueryDependencies();

  const access = await authorizePackageAccess.execute(packageId);
  if (!access.ok) {
    if (access.error.code === "package.not_found") notFound();
    if (access.error.code === "auth.unauthenticated") redirect("/login");
    console.error(`[PackagePage] No se pudo autorizar el paquete (${randomUUID()}):`, access.error.code);
    return { status: "error" };
  }

  const detail = await getPackageDetail.execute({ packageId, userId: access.value.id });
  if (!detail.ok) {
    if (detail.error.code === "package.not_found") notFound();
    console.error(`[PackagePage] No se pudo leer el paquete (${randomUUID()}):`, detail.error.code);
    return { status: "error" };
  }

  const budget = await getBudget.execute(packageId);
  if (!budget.ok && budget.error.code !== "budget.not_found") {
    console.error(`[PackagePage] No se pudo leer el presupuesto (${randomUUID()}):`, budget.error.code);
  }

  return {
    budget: budget.ok
      ? {
          packageVersion: budget.value.packageVersion,
          status: "confirmed",
          totalCop: budget.value.totalCop,
        }
      : { status: budget.error.code === "budget.not_found" ? "pending" : "error" },
    detail: detail.value,
    status: "ready",
  };
}

export default async function PackagePage({ params }: PackagePageProps) {
  // Verificación efectiva por página: el layout no corre en la navegación del
  // cliente (ver src/composition/session-guard.ts).
  await requireSessionUser();

  const { packageId } = await params;
  // El configurador necesita el paquete real; en modo simulado (DECOR-20) el
  // paquete sólo existe en el navegador y la página sigue como antes.
  const isLive = resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) === "live";
  const configurator = isLive ? await loadConfigurator(packageId) : null;
  // Conteo confirmado por el servidor: el catálogo lo usa para reconciliar su
  // eco local tras agregar o quitar (DECOR-22).
  const serverCounts =
    configurator?.status === "ready" ? countUnitsByModule(configurator.detail.nodes) : undefined;

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-nav">
          <Link className="auth-link" href="/packages">
            ← Cambiar espacio
          </Link>
          <DuplicatePackageButton packageId={packageId} />
        </div>
        <PageHeading>Tu paquete</PageHeading>
        <p className="page-lead">
          {isLive
            ? "Revisa tu espacio, agrega o quita elementos y duplica la configuración."
            : "Elige los módulos que quieres en tu decoración."}
        </p>
      </header>

      {configurator === null ? (
        <p className="simulation-note">
          El contenido del paquete, el área usada y el presupuesto confirmado se muestran con la API real
          (modo live).
        </p>
      ) : null}

      {configurator?.status === "error" ? (
        <section className="configurator-card catalog-error catalog-state">
          <p className="auth-error" role="alert">
            No pudimos cargar tu paquete.
          </p>
          <RefreshButton label="Reintentar" />
        </section>
      ) : null}

      {configurator?.status === "ready" ? (
        <>
          <div className="configurator-summary">
            <SpaceSummary detail={configurator.detail} />
            <BudgetTotal
              budget={configurator.budget}
              packageId={packageId}
              packageVersion={configurator.detail.version}
            />
          </div>
          <PackageContents
            nodes={configurator.detail.nodes}
            packageId={packageId}
            version={configurator.detail.version}
          />
        </>
      ) : null}

      <WelcomeZoneButton packageId={packageId} />

      <PackageCatalog
        packageId={packageId}
        packageVersion={configurator?.status === "ready" ? configurator.detail.version : undefined}
        remainingM2={configurator?.status === "ready" ? configurator.detail.remainingM2 : undefined}
        serverCounts={serverCounts}
      />
    </main>
  );
}
