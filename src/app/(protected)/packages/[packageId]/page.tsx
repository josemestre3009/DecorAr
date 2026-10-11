import type { Metadata } from "next";
import Link from "next/link";

import { requireSessionUser } from "@/composition/session-guard";

import { DuplicatePackageButton } from "./duplicate-package-button";
import { PackageCatalog } from "./package-catalog";
import { PageHeading } from "./page-heading";
import { WelcomeZoneButton } from "./welcome-zone-button";

export const metadata: Metadata = {
  title: "Tu paquete · DecorAR",
};

type PackagePageProps = {
  readonly params: Promise<{ readonly packageId: string }>;
};

export default async function PackagePage({ params }: PackagePageProps) {
  // Verificación efectiva por página: el layout no corre en la navegación del
  // cliente (ver src/composition/session-guard.ts).
  await requireSessionUser();

  const { packageId } = await params;

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
        <p className="page-lead">Elige los módulos que quieres en tu decoración.</p>
      </header>

      <WelcomeZoneButton packageId={packageId} />

      <PackageCatalog packageId={packageId} />
    </main>
  );
}
