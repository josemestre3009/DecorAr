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
  readonly packageVersion?: number;
  /** Inyectables para las pruebas. */
  readonly client?: PackagesClient;
  readonly fetcher?: typeof fetch;
  /** Unidades confirmadas por el servidor por `moduleId`; reconcilia el eco local tras un refresco (DECOR-22). */
  readonly serverCounts?: Readonly<Record<string, number>>;
  readonly remainingM2?: number;
};

const IDLE: AddState = { status: "idle" };

export function PackageCatalog({ packageId, packageVersion, client, fetcher, remainingM2, serverCounts }: PackageCatalogProps) {
  const router = useRouter();
  const packages = client ?? getPackagesClient();
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [addStates, setAddStates] = useState<Record<string, AddState>>({});
  // Cuántas veces se agregó cada módulo; se guarda aparte porque el estado
  // "adding" reemplaza al anterior mientras la petición está en curso.
  const [localChanges, setLocalChanges] = useState<{
    readonly counts: Record<string, number>;
    readonly usedM2: number;
    readonly version?: number;
  }>({ counts: {}, usedM2: 0, version: packageVersion });
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

  async function add(module: CatalogModuleDto, quantity: number): Promise<boolean> {
    setAddStates((states) => ({ ...states, [module.id]: { status: "adding" } }));
    setAnnouncement(
      quantity === 1 ? `Agregando ${module.name}…` : `Agregando ${quantity} unidades de ${module.name}…`,
    );

    const result = quantity === 1
      ? await packages.addItem(packageId, module.id)
      : await packages.addItem(packageId, module.id, quantity);

    if (result.ok) {
      setLocalChanges((changes) => {
        const current = changes.version === packageVersion ? changes : { counts: {}, usedM2: 0 };
        return {
          counts: { ...current.counts, [module.id]: (current.counts[module.id] ?? 0) + quantity },
          usedM2: current.usedM2 + module.areaM2 * quantity,
          version: packageVersion,
        };
      });
      setAddStates((states) => {
        const next = { ...states };
        delete next[module.id];
        return next;
      });
      setAnnouncement(
        quantity === 1
          ? `${module.name} se agregó a tu paquete.`
          : `${quantity} unidades de ${module.name} se agregaron a tu paquete.`,
      );
      // Con la API real, el contenido y el área usada se vuelven a leer del servidor (DECOR-22).
      if (packages.mode === "live") {
        router.refresh();
      }
      return true;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return false;
    }

    setAddStates((states) => ({
      ...states,
      [module.id]: { message: result.error.message, status: "error" },
    }));
    setAnnouncement("");
    return false;
  }

  // "Agregado N veces" sale de las unidades confirmadas por el servidor cuando
  // están disponibles, así no queda pegado cuando se quita desde el contenido
  // (DECOR-22); en modo simulado (o sin lectura de servidor) se usa el eco local.
  function cardAddState(moduleId: string): AddState {
    const pending = addStates[moduleId];
    if (pending?.status === "adding" || pending?.status === "error") {
      return pending;
    }

    const localCount = localChanges.version === packageVersion ? (localChanges.counts[moduleId] ?? 0) : 0;
    const count = (serverCounts?.[moduleId] ?? 0) + localCount;
    return count > 0 ? { count, status: "added" } : IDLE;
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
                addState={cardAddState(module.id)}
                module={module}
                onAdd={add}
                packageId={packageId}
                remainingM2={remainingM2 === undefined
                  ? undefined
                  : Math.max(0, remainingM2 - (localChanges.version === packageVersion ? localChanges.usedM2 : 0))}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
