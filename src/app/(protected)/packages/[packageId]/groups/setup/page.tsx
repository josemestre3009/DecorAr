import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createPackageQueryDependencies } from "@/composition/server";
import { requireSessionUser } from "@/composition/session-guard";

import { toGroupOptions, type GroupOption } from "../../../_lib/configurator-view";
import { resolvePackagesMode } from "../../../_lib/packages-client";
import { PageHeading } from "../../page-heading";
import { RefreshButton } from "../../refresh-button";
import { GroupManager } from "./group-manager";

export const metadata: Metadata = {
  title: "Organiza tus zonas · DecorAR",
};

type GroupSetupPageProps = {
  readonly params: Promise<{ readonly packageId: string }>;
};

type GroupSetup = { readonly status: "ready"; readonly groups: GroupOption[] } | { readonly status: "error" };

/**
 * Lee las zonas del paquete en el servidor, igual que el configurador: un
 * paquete ajeno o inexistente responde 404 sin revelar que existe.
 */
export async function loadGroups(packageId: string): Promise<GroupSetup> {
  const { authorizePackageAccess, getPackageDetail } = await createPackageQueryDependencies();

  const access = await authorizePackageAccess.execute(packageId);
  if (!access.ok) {
    if (access.error.code === "package.not_found") notFound();
    if (access.error.code === "auth.unauthenticated") redirect("/login");
    console.error(`[GroupSetupPage] No se pudo autorizar el paquete (${randomUUID()}):`, access.error.code);
    return { status: "error" };
  }

  const detail = await getPackageDetail.execute({ packageId, userId: access.value.id });
  if (!detail.ok) {
    if (detail.error.code === "package.not_found") notFound();
    console.error(`[GroupSetupPage] No se pudo leer el paquete (${randomUUID()}):`, detail.error.code);
    return { status: "error" };
  }

  return { groups: toGroupOptions(detail.value.nodes), status: "ready" };
}

/**
 * Paso opcional entre el espacio y el catálogo (DECOR-43): organizar el
 * paquete en zonas. Solo existe con la API real; en modo simulado no hay
 * grupos persistentes y se continúa directo al configurador.
 */
export default async function GroupSetupPage({ params }: GroupSetupPageProps) {
  await requireSessionUser();

  const { packageId } = await params;
  const configuratorHref = `/packages/${encodeURIComponent(packageId)}`;

  if (resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) !== "live") {
    redirect(configuratorHref);
  }

  const setup = await loadGroups(packageId);

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-nav">
          <Link className="auth-link" href={configuratorHref}>
            ← Ir al paquete
          </Link>
        </div>
        <PageHeading>Organiza tus zonas</PageHeading>
        <p className="page-lead">
          Agrupa tu decoración en zonas como «Sala» o «Mesa principal», con hasta tres niveles. Es opcional:
          puedes hacerlo después desde «Administrar zonas».
        </p>
      </header>

      {setup.status === "error" ? (
        <section className="configurator-card catalog-error catalog-state">
          <p className="auth-error" role="alert">
            No pudimos cargar tus zonas.
          </p>
          <RefreshButton label="Reintentar" />
        </section>
      ) : (
        <GroupManager groups={setup.groups} packageId={packageId} />
      )}
    </main>
  );
}
