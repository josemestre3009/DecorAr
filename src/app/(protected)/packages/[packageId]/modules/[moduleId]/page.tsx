import type { Metadata } from "next";
import Link from "next/link";

import { requireSessionUser } from "@/composition/session-guard";

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

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <Link className="auth-link" href={`/packages/${encodeURIComponent(packageId)}`}>
          ← Volver al catálogo
        </Link>
        <PageHeading>Ver en 3D</PageHeading>
        <p className="page-lead">
          Gira el modelo y ábrelo en tu espacio para verlo a su tamaño real.
        </p>
      </header>

      <ModuleViewer moduleId={moduleId} packageId={packageId} />
    </main>
  );
}
