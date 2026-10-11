"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";

import { fetchCatalogModules } from "../_lib/catalog-client";
import { getPackageGroupsClient, type PackageGroupsClient } from "../_lib/package-groups-client";

/** Demo mínima del Composite (docs/DecorAR.md §1.4): arco floral + mesa redonda. */
export const WELCOME_ZONE_NAME = "Zona de bienvenida";
export const WELCOME_ZONE_ASSET_IDS = ["arco", "mesa"] as const;

type WelcomeZoneButtonProps = {
  readonly packageId: string;
  /** Inyectables para las pruebas. */
  readonly client?: PackageGroupsClient;
  readonly fetcher?: typeof fetch;
};

type CreatedZone = {
  readonly groupId: string;
  readonly children: readonly CatalogModuleDto[];
};

/**
 * Hace visible el Composite desde la interfaz: crea el grupo "Zona de
 * bienvenida" con el arco y la mesa activos del catálogo. Con la API real
 * refresca la página y el grupo aparece en el contenido del paquete
 * (DECOR-22); en modo simulado lo muestra aquí mismo.
 */
export function WelcomeZoneButton({ packageId, client, fetcher }: WelcomeZoneButtonProps) {
  const router = useRouter();
  const groups = client ?? getPackageGroupsClient();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zones, setZones] = useState<CreatedZone[]>([]);

  async function handleCreate() {
    setIsPending(true);
    setErrorMessage(null);

    const catalog = await fetchCatalogModules(fetcher);
    if (!catalog.ok) {
      setIsPending(false);
      if (catalog.error.kind === "unauthorized") {
        router.push("/login");
        return;
      }
      setErrorMessage(catalog.error.message);
      return;
    }

    const children = WELCOME_ZONE_ASSET_IDS.map((assetId) =>
      catalog.value.find((module) => module.assetId === assetId),
    );
    if (children.some((module) => module === undefined)) {
      setIsPending(false);
      setErrorMessage("El catálogo no tiene disponibles el arco floral y la mesa redonda.");
      return;
    }

    const modules = children as CatalogModuleDto[];
    const result = await groups.createGroup(packageId, {
      moduleIds: modules.map((module) => module.id),
      name: WELCOME_ZONE_NAME,
    });

    setIsPending(false);

    if (result.ok) {
      if (groups.mode === "live") {
        // El contenido del paquete (DECOR-22) muestra el grupo leído del servidor.
        router.refresh();
        return;
      }

      setZones((current) => [...current, { children: modules, groupId: result.value.groupId }]);
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setErrorMessage(result.error.message);
  }

  return (
    <section aria-labelledby="welcome-zone-title" className="welcome-zone">
      <h2 className="section-title" id="welcome-zone-title">
        Grupos decorativos
      </h2>
      <button
        aria-busy={isPending}
        className="secondary-button"
        disabled={isPending}
        onClick={handleCreate}
        type="button"
      >
        {isPending ? "Agregando Zona de bienvenida…" : "Agregar Zona de bienvenida"}
      </button>

      {errorMessage ? (
        <p className="auth-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div aria-live="polite" role="status">
        {zones.map((zone) => (
          <article aria-label={WELCOME_ZONE_NAME} key={zone.groupId}>
            <h3>{WELCOME_ZONE_NAME}</h3>
            <ul>
              {zone.children.map((module) => (
                <li key={module.id}>{module.name}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
