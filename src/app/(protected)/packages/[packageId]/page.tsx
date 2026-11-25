import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { PackageDetailView } from "@/modules/packages/application/dtos/package-detail.dto";
import { createPackageQueryDependencies } from "@/composition/server";
import { requireSessionUser } from "@/composition/session-guard";

import { Icon } from "../../_ui/icon";
import { countUnitsByModule, type ConfiguratorBudget } from "../_lib/configurator-view";
import { eventSectionLabel, parseEventSection } from "../_lib/event-sections";
import { formatCop } from "../_lib/format";
import { resolvePackagesMode } from "../_lib/packages-client";
import { buildZoneTree, flattenZones } from "../_lib/zone-tree";
import { BudgetTotal } from "./budget-total";
import { CreateQuoteForm } from "./create-quote-form";
import { DuplicatePackageButton } from "./duplicate-package-button";
import { EventMetadataEditor } from "./event-metadata-editor";
import { EventNav } from "./event-nav";
import { EventSummary } from "./event-summary";
import { NextStep } from "./next-step";
import { PackageCatalog } from "./package-catalog";
import { PackageContents } from "./package-contents";
import { PackageQuotes } from "./package-quotes";
import { PageHeading } from "./page-heading";
import { RefreshButton } from "./refresh-button";
import { SaveTemplateButton } from "./save-template-button";

export const metadata: Metadata = {
  title: "Tu evento · DecorAR",
};

type PackagePageProps = {
  readonly params: Promise<{ readonly packageId: string }>;
  /** `?seccion=` elige la sección del evento (rediseño visual móvil). */
  readonly searchParams?: Promise<{ readonly seccion?: string | string[] }>;
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

export default async function PackagePage({ params, searchParams }: PackagePageProps) {
  // Verificación efectiva por página: el layout no corre en la navegación del
  // cliente (ver src/composition/session-guard.ts).
  await requireSessionUser();

  const { packageId } = await params;
  const section = parseEventSection((await searchParams)?.seccion);
  // El configurador necesita el paquete real; en modo simulado (DECOR-20) el
  // paquete sólo existe en el navegador y la página sigue como antes.
  const isLive = resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) === "live";
  const configurator = isLive ? await loadConfigurator(packageId) : null;
  const ready = configurator?.status === "ready" ? configurator : null;
  // Conteo confirmado por el servidor: el catálogo lo usa para reconciliar su
  // eco local tras agregar o quitar (DECOR-22).
  const serverCounts = ready ? countUnitsByModule(ready.detail.nodes) : undefined;
  const detail = ready?.detail ?? null;
  // Zonas planas para los selectores de destino del contenido y el catálogo.
  const zones = detail ? flattenZones(buildZoneTree(detail.nodes)) : [];
  const unitCount = serverCounts ? Object.values(serverCounts).reduce((total, count) => total + count, 0) : 0;
  const totalLabel = ready?.budget.status === "confirmed" ? formatCop(ready.budget.totalCop) : null;

  const catalog = (
    <PackageCatalog
      packageId={packageId}
      packageVersion={detail?.version}
      remainingM2={detail?.remainingM2 ?? undefined}
      serverCounts={serverCounts}
      zones={zones}
    />
  );

  // Modo simulado (DECOR-20) o error de carga: no hay secciones que recorrer.
  if (!detail || !ready) {
    return (
      <main className="catalog-page">
        <header className="catalog-header">
          <div className="catalog-nav">
            <Link className="back-link" href="/packages">
              <Icon name="back" size={18} />
              Eventos
            </Link>
          </div>
          <PageHeading>Tu evento</PageHeading>
          <p className="page-lead">Elige los módulos que quieres en tu decoración.</p>
        </header>

        {configurator === null ? (
          <p className="simulation-note">
            El contenido del evento, el área usada y el presupuesto confirmado se muestran con la API real
            (modo live).
          </p>
        ) : null}

        {configurator?.status === "error" ? (
          <section className="configurator-card catalog-error catalog-state">
            <p className="auth-error" role="alert">
              No pudimos cargar tu evento.
            </p>
            <RefreshButton label="Reintentar" />
          </section>
        ) : null}

        {catalog}
      </main>
    );
  }

  const isOverview = section === "evento";

  return (
    <div className="event-shell">
      <EventNav
        active={section}
        eventName={detail.name}
        packageId={packageId}
        totalLabel={totalLabel}
        unitCount={unitCount}
      />

      <main className="catalog-page event-main">
        <header className="event-header">
          <Link className="back-link" href="/packages">
            <Icon name="back" size={18} />
            Eventos
          </Link>
          <p className="event-kicker">{isOverview ? "Tu evento" : detail.name}</p>
          {/* La clave mueve el foco al título al cambiar de sección. */}
          <PageHeading key={section}>{isOverview ? detail.name : eventSectionLabel(section)}</PageHeading>
        </header>

        <div className="event-section" key={section}>
          {section === "evento" ? (
            <>
              <BudgetTotal budget={ready.budget} packageId={packageId} packageVersion={detail.version} />
              <NextStep packageId={packageId} unitCount={unitCount} />
              <EventSummary detail={detail} />
              <EventMetadataEditor detail={detail} packageId={packageId} />
            </>
          ) : null}

          {section === "objetos" ? (
            <PackageContents nodes={detail.nodes} packageId={packageId} version={detail.version} />
          ) : null}

          {section === "catalogo" ? (
            <>
              <p className="flow-hint" id="montaje">
                <Icon name="cube" size={18} />
                <span>
                  <strong>Montaje 3D:</strong> toca el cubo de cualquier elemento para verlo a tamaño real y, si tu
                  celular lo permite, en tu espacio.
                </span>
              </p>
              {catalog}
            </>
          ) : null}

          {section === "cotizar" ? (
            <>
              <PackageQuotes packageId={packageId} />
              <CreateQuoteForm clientName={detail.clientName} hasItems={unitCount > 0} packageId={packageId} />
            </>
          ) : null}

          {section === "mas" ? (
            <>
              <SaveTemplateButton eventName={detail.name} packageId={packageId} />
              <section aria-labelledby="duplicate-title" className="configurator-card">
                <h2 className="section-title" id="duplicate-title">
                  Duplicar evento
                </h2>
                <p className="content-hint">
                  Crea una copia con los mismos elementos y zonas para empezar otro evento parecido.
                </p>
                <DuplicatePackageButton packageId={packageId} />
              </section>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
