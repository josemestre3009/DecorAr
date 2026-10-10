"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";

import { fetchCatalogModules } from "../_lib/catalog-client";
import { getPackagesClient, type PackagesClient } from "../_lib/packages-client";
import { ModuleCard, type AddState } from "./module-card";

type CatalogState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly modules: CatalogModuleDto[] };

type PackageCatalogProps = {
  readonly packageId: string;
  /** Inyectables para las pruebas. */
  readonly client?: PackagesClient;
  readonly fetcher?: typeof fetch;
};

const IDLE: AddState = { status: "idle" };

export function PackageCatalog({ packageId, client, fetcher }: PackageCatalogProps) {
  const router = useRouter();
  const packages = client ?? getPackagesClient();
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [addStates, setAddStates] = useState<Record<string, AddState>>({});
  // Cuántas veces se agregó cada módulo; se guarda aparte porque el estado
  // "adding" reemplaza al anterior mientras la petición está en curso.
  const [addedCounts, setAddedCounts] = useState<Record<string, number>>({});
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetchCatalogModules(fetcher, controller.signal)
      .then((result) => {
        if (result.ok) {
          setCatalog({ modules: result.value, status: "ready" });
          return;
        }

        if (result.error.kind === "unauthorized") {
          router.push("/login");
          return;
        }

        setCatalog({ message: result.error.message, status: "error" });
      })
      .catch(() => {
        // Solo llega aquí una petición cancelada al desmontar o reintentar.
      });

    return () => controller.abort();
  }, [attempt, fetcher, router]);

  function retry() {
    setCatalog({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  async function add(module: CatalogModuleDto) {
    setAddStates((states) => ({ ...states, [module.id]: { status: "adding" } }));
    setAnnouncement(`Agregando ${module.name}…`);

    const result = await packages.addItem(packageId, module.id);

    if (result.ok) {
      const count = (addedCounts[module.id] ?? 0) + 1;

      setAddedCounts((counts) => ({ ...counts, [module.id]: (counts[module.id] ?? 0) + 1 }));
      setAddStates((states) => ({ ...states, [module.id]: { count, status: "added" } }));
      setAnnouncement(`${module.name} se agregó a tu paquete.`);
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setAddStates((states) => ({
      ...states,
      [module.id]: { message: result.error.message, status: "error" },
    }));
    setAnnouncement("");
  }

  return (
    <section aria-busy={catalog.status === "loading"} aria-labelledby="catalog-title">
      <h2 className="section-title" id="catalog-title">
        Catálogo
      </h2>

      {packages.mode === "simulated" ? (
        <p className="simulation-note">
          Modo simulado: mientras se integra la API de paquetes, lo que agregues se guarda
          solo en este navegador.
        </p>
      ) : null}

      {/* Una sola región viva para anunciar el resultado de "Agregar". */}
      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>

      {catalog.status === "loading" ? (
        <p className="catalog-state" role="status">
          <span aria-hidden="true" className="spinner" />
          Cargando catálogo…
        </p>
      ) : null}

      {catalog.status === "error" ? (
        <div className="catalog-state catalog-error">
          <p className="auth-error" role="alert">
            No pudimos cargar el catálogo. {catalog.message}
          </p>
          <button className="secondary-button" onClick={retry} type="button">
            Reintentar
          </button>
        </div>
      ) : null}

      {catalog.status === "ready" && catalog.modules.length === 0 ? (
        <div className="catalog-state">
          <p className="catalog-empty">Todavía no hay módulos disponibles en el catálogo.</p>
          <button className="secondary-button" onClick={retry} type="button">
            Volver a consultar
          </button>
        </div>
      ) : null}

      {catalog.status === "ready" && catalog.modules.length > 0 ? (
        <ul className="module-grid">
          {catalog.modules.map((module) => (
            <li key={module.id}>
              <ModuleCard
                addState={addStates[module.id] ?? IDLE}
                module={module}
                onAdd={add}
                packageId={packageId}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
