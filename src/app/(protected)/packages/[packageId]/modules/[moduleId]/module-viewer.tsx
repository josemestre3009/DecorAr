"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PrepararVistaARUseCase, VistaAR } from "@/modules/ar/application/use-cases/preparar-vista-ar.use-case";
import type { CapacidadesAR } from "@/modules/ar/domain/capacidades-ar";
import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";

import { detectarCapacidadesAR } from "../../../_lib/ar-capabilities";
import { prepararVistaAR } from "../../../_lib/ar-view";
import { fetchCatalogModule } from "../../../_lib/catalog-client";
import { formatCop } from "../../../_lib/format";
import { ModelViewerClient } from "./model-viewer-client";

type ViewState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "not_found"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "ready"; readonly module: CatalogModuleDto; readonly vista: VistaAR };

type ModuleViewerProps = {
  readonly packageId: string;
  readonly moduleId: string;
  /** Inyectables para las pruebas. */
  readonly fetcher?: typeof fetch;
  readonly detect?: () => Promise<CapacidadesAR>;
  readonly useCase?: PrepararVistaARUseCase;
  readonly loadLibrary?: () => Promise<unknown>;
};

const METROS = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

const detectFromNavigator = () => detectarCapacidadesAR(navigator);

export function ModuleViewer({
  packageId,
  moduleId,
  fetcher,
  detect = detectFromNavigator,
  useCase = prepararVistaAR,
  loadLibrary,
}: ModuleViewerProps) {
  const router = useRouter();
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([fetchCatalogModule(moduleId, fetcher, controller.signal), detect()])
      .then(([result, capacidades]) => {
        if (controller.signal.aborted) return;

        if (!result.ok) {
          if (result.error.kind === "unauthorized") {
            router.push("/login");
            return;
          }

          setView({
            message: result.error.message,
            status: result.error.kind === "not_found" ? "not_found" : "error",
          });
          return;
        }

        const vista = useCase.execute(result.value, capacidades);

        setView(
          vista.ok
            ? { module: result.value, status: "ready", vista: vista.value }
            : { message: vista.error.message, status: "unavailable" },
        );
      })
      .catch(() => {
        // Una petición cancelada al desmontar o reintentar no cambia la vista;
        // cualquier otro fallo inesperado no debe dejarla cargando para siempre.
        if (!controller.signal.aborted) {
          setView({ message: "Inténtalo de nuevo.", status: "error" });
        }
      });

    return () => controller.abort();
  }, [attempt, detect, fetcher, moduleId, router, useCase]);

  function retry() {
    setView({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  const catalogHref = `/packages/${encodeURIComponent(packageId)}`;

  return (
    <section aria-busy={view.status === "loading"} aria-labelledby="viewer-title">
      {view.status === "ready" ? (
        <h2 className="section-title" id="viewer-title">
          {view.module.name}
        </h2>
      ) : (
        <h2 className="visually-hidden" id="viewer-title">
          Modelo 3D
        </h2>
      )}

      {view.status === "loading" ? (
        <p className="catalog-state" role="status">
          <span aria-hidden="true" className="spinner" />
          Cargando el módulo…
        </p>
      ) : null}

      {view.status === "error" ? (
        <div className="catalog-state catalog-error">
          <p className="auth-error" role="alert">
            No pudimos cargar el módulo. {view.message}
          </p>
          <button className="secondary-button" onClick={retry} type="button">
            Reintentar
          </button>
        </div>
      ) : null}

      {view.status === "not_found" || view.status === "unavailable" ? (
        <div className="catalog-state">
          <p className="auth-error" role="alert">
            {view.message}
          </p>
          <Link className="secondary-link" href={catalogHref}>
            Volver al catálogo
          </Link>
        </div>
      ) : null}

      {view.status === "ready" ? (
        <>
          <dl className="module-facts ar-facts">
            <div>
              <dt>Medidas reales</dt>
              <dd>
                {METROS.format(view.module.widthM)} × {METROS.format(view.module.heightM)} ×{" "}
                {METROS.format(view.module.depthM)} m
              </dd>
            </div>
            <div>
              <dt>Precio</dt>
              <dd>{formatCop(view.module.priceCop)}</dd>
            </div>
          </dl>
          <p className="ar-scale-note">
            Ancho × alto × fondo. En tu espacio se muestra a escala real 1:1 y no se puede
            agrandar ni achicar.
          </p>

          <ModelViewerClient
            assetKey={view.vista.elemento.instancia.activo.clave}
            configuracion={view.vista.configuracion}
            loadLibrary={loadLibrary}
          />
        </>
      ) : null}
    </section>
  );
}
