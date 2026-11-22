import type { Metadata } from "next";
import Link from "next/link";

import { requireSessionUser } from "@/composition/session-guard";

import { PageHeading } from "../../../page-heading";
import { WebXRValidationView } from "./webxr-validation-view";

export const metadata: Metadata = {
  title: "Validación WebXR multiobjeto · DecorAR",
};

type WebXRValidationPageProps = Readonly<{
  params: Promise<{ packageId: string; moduleId: string }>;
}>;

export default async function WebXRValidationPage({ params }: WebXRValidationPageProps) {
  await requireSessionUser();
  const { packageId, moduleId } = await params;

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <Link
          className="auth-link"
          href={`/packages/${encodeURIComponent(packageId)}/modules/${encodeURIComponent(moduleId)}`}
        >
          ← Volver al visor individual
        </Link>
        <PageHeading>Validación WebXR multiobjeto</PageHeading>
        <p className="page-lead">
          Prueba de rendimiento y estabilidad en Android real con 1, 5, 10 y 20 objetos a escala real.
        </p>
      </header>
      <WebXRValidationView moduleId={moduleId} packageId={packageId} />
    </main>
  );
}
