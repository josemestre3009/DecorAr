import type { Metadata } from "next";
import Link from "next/link";

import { requireSessionUser } from "@/composition/session-guard";

import { PageHeading } from "../../../page-heading";
import { WebXRSpike } from "./webxr-spike";

export const metadata: Metadata = { title: "Spike WebXR · DecorAR" };

type SpikePageProps = Readonly<{
  params: Promise<{ packageId: string; moduleId: string }>;
}>;

export default async function SpikePage({ params }: SpikePageProps) {
  await requireSessionUser();
  const { packageId, moduleId } = await params;

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <Link className="auth-link" href={`/packages/${encodeURIComponent(packageId)}/modules/${encodeURIComponent(moduleId)}`}>
          ← Volver al visor individual
        </Link>
        <PageHeading>Spike WebXR multiobjeto</PageHeading>
        <p className="page-lead">Coloca, selecciona, mueve y gira hasta tres copias a escala real.</p>
      </header>
      <WebXRSpike moduleId={moduleId} />
    </main>
  );
}
