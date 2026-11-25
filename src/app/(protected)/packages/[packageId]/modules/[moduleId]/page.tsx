import type { Metadata } from "next";
import Link from "next/link";

import { requireSessionUser } from "@/composition/session-guard";

import { Icon } from "../../../../_ui/icon";
import { eventSectionHref } from "../../../_lib/event-sections";
import { resolvePackagesMode } from "../../../_lib/packages-client";
import { EventNav } from "../../event-nav";
import { PageHeading } from "../../page-heading";
import { ModuleViewer } from "./module-viewer";

export const metadata: Metadata = {
  title: "Ver en 3D · DecorAR",
};

type ModulePageProps = {
  readonly params: Promise<{ readonly packageId: string; readonly moduleId: string }>;
};

export default async function ModulePage({ params }: ModulePageProps) {
  // Verificación efectiva por página: el layout no corre en la navegación del
  // cliente (ver src/composition/session-guard.ts).
  await requireSessionUser();

  const { packageId, moduleId } = await params;
  // Las secciones del evento solo existen con la API real (DECOR-20).
  const isLive = resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) === "live";
  const catalogHref = isLive ? eventSectionHref(packageId, "catalogo") : `/packages/${encodeURIComponent(packageId)}`;

  const content = (
    <main className={isLive ? "catalog-page event-main" : "catalog-page"}>
      <header className="event-header">
        <Link className="back-link" href={catalogHref}>
          <Icon name="back" size={18} />
          Volver al catálogo
        </Link>
        <p className="event-kicker">Montaje 3D</p>
        <PageHeading>Ver en 3D</PageHeading>
        <p className="page-lead">Gira el modelo y ábrelo en tu espacio para verlo a su tamaño real.</p>
      </header>

      <ModuleViewer catalogHref={catalogHref} moduleId={moduleId} packageId={packageId} />
    </main>
  );

  return isLive ? (
    <div className="event-shell">
      <EventNav active="catalogo" packageId={packageId} />
      {content}
    </div>
  ) : (
    content
  );
}
