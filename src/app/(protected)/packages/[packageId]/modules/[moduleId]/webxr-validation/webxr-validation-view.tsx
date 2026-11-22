"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FabricaActivos3D } from "@/modules/ar/domain/fabrica-activos-3d";
import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";

import { fetchCatalogModule, fetchCatalogModules } from "../../../../_lib/catalog-client";
import type {
  WebXRValidationDiagnostics,
  WebXRValidationModule,
  WebXRValidationRuntime,
} from "./webxr-validation-runtime";

type Status = "checking" | "unsupported" | "ready" | "starting" | "running" | "error";

type RuntimeStarter = typeof import("./webxr-validation-runtime")["startWebXRValidationRuntime"];

type WebXRValidationViewProps = Readonly<{
  packageId: string;
  moduleId: string;
  fetcher?: typeof fetch;
  startRuntime?: RuntimeStarter;
  xr?: Pick<XRSystem, "isSessionSupported">;
}>;

const EMPTY_DIAGNOSTICS: WebXRValidationDiagnostics = {
  activosFlyweight: 0,
  domOverlay: false,
  failures: "ninguno",
  fpsAverage: 0,
  fpsCurrent: 0,
  fpsMin: 0,
  grantedFeatures: "ninguna",
  lastEvent: "ninguno",
  memory: "n/d",
  objectCount: 0,
  renderInfo: { calls: 0, geometries: 0, textures: 0, triangles: 0 },
  targetCount: 1,
};

const loadRuntime: RuntimeStarter = async (options) => {
  const runtime = await import("./webxr-validation-runtime");
  return runtime.startWebXRValidationRuntime(options);
};

export function WebXRValidationView({
  packageId,
  moduleId,
  fetcher,
  startRuntime = loadRuntime,
  xr,
}: WebXRValidationViewProps) {
  const [status, setStatus] = useState<Status>("checking");
  const [currentModule, setCurrentModule] = useState<CatalogModuleDto | null>(null);
  const [allModules, setAllModules] = useState<readonly CatalogModuleDto[]>([]);
  const [message, setMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState(EMPTY_DIAGNOSTICS);
  const [platform, setPlatform] = useState("pendiente");
  const [selectedTargetCount, setSelectedTargetCount] = useState<number>(1);
  const [copied, setCopied] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<WebXRValidationRuntime | null>(null);
  const [fabrica] = useState(() => new FabricaActivos3D());
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Hallazgo 10: Efecto de montaje y desmontaje para cleanup de sesión y timeouts
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      void runtimeRef.current?.end();
    };
  }, []);

  // Hallazgo 10: Efecto de carga independiente sin matar la sesión si cambian fetcher/moduleId
  useEffect(() => {
    const controller = new AbortController();
    const xrSystem = xr ?? (typeof navigator !== "undefined" ? navigator.xr : undefined);

    Promise.all([
      fetchCatalogModule(moduleId, fetcher, controller.signal),
      fetchCatalogModules(fetcher, controller.signal),
      xrSystem?.isSessionSupported("immersive-ar") ?? Promise.resolve(false),
    ])
      .then(([singleRes, allRes, supported]) => {
        if (controller.signal.aborted || !isMountedRef.current) return;
        setPlatform(typeof navigator !== "undefined" ? navigator.userAgent : "desconocido");

        if (!singleRes.ok) {
          setMessage(singleRes.error.message);
          setStatus("error");
          return;
        }

        setCurrentModule(singleRes.value);
        if (allRes.ok) {
          setAllModules(allRes.value);
        } else {
          // Hallazgo 10: avisar si fetchCatalogModules falla
          setAllModules([singleRes.value]);
          setMessage("No se pudo cargar todo el catálogo; se usará solo el modelo actual.");
        }

        if (!supported) {
          setStatus("unsupported");
        } else {
          setStatus("ready");
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && isMountedRef.current) {
          // Hallazgo 11: no tragar errores
          const errDetail = e instanceof Error ? e.message : "Error de red";
          setMessage(`No se pudieron comprobar las capacidades del dispositivo: ${errDetail}`);
          setStatus("error");
        }
      });

    return () => {
      controller.abort();
    };
  }, [fetcher, moduleId, xr]);

  async function start() {
    if (!currentModule || !stageRef.current || !overlayRef.current) return;
    setStatus("starting");
    setMessage("");

    const primary: WebXRValidationModule = currentModule;
    const available: readonly WebXRValidationModule[] =
      allModules.length > 0 ? allModules : [currentModule];

    if (!window.isSecureContext) {
      setMessage("WebXR requiere una conexión HTTPS (contexto seguro). Abre esta página por HTTPS.");
      setStatus("error");
      return;
    }

    try {
      const runtimeInstance = await startRuntime({
        availableModules: available,
        container: stageRef.current,
        fabrica,
        onDiagnostics: (diag) => {
          if (isMountedRef.current) {
            setDiagnostics(diag);
          }
        },
        onEnd: (failed) => {
          runtimeRef.current = null;
          if (!isMountedRef.current) return;
          if (failed) {
            setMessage("La sesión AR terminó con errores. Revisa el diagnóstico e inténtalo de nuevo.");
            setStatus("error");
            return;
          }
          setDiagnostics(EMPTY_DIAGNOSTICS);
          setStatus("ready");
        },
        overlayRoot: overlayRef.current,
        primaryModule: primary,
        targetCount: selectedTargetCount,
      });

      // Hallazgo 2: Si el efecto se limpió o se canceló, finalizar runtime de inmediato
      if (!isMountedRef.current) {
        void runtimeInstance.end();
        return;
      }

      runtimeRef.current = runtimeInstance;
      setStatus("running");
    } catch (e: unknown) {
      if (isMountedRef.current) {
        const errDetail = e instanceof Error ? e.message : "Error iniciando WebXR";
        setMessage(`No se pudo iniciar la sesión AR: ${errDetail}. Revisa permisos, ARCore y la conexión HTTPS.`);
        setStatus("error");
      }
    }
  }

  function handleTargetChange(count: number) {
    setSelectedTargetCount(count);
    if (runtimeRef.current) {
      runtimeRef.current.populateTarget(count);
    }
  }

  async function copyDiagnostics() {
    if (!runtimeRef.current) return;
    const json = runtimeRef.current.exportDiagnostics();
    try {
      await navigator.clipboard.writeText(json);
      if (isMountedRef.current) {
        setCopied(true);
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setCopied(false);
          }
        }, 2500);
      }
    } catch (e: unknown) {
      if (isMountedRef.current) {
        const errDetail = e instanceof Error ? e.message : "Error al portapapeles";
        setMessage(`No se pudo copiar al portapapeles: ${errDetail}`);
      }
    }
  }

  const individualViewerHref = `/packages/${encodeURIComponent(packageId)}/modules/${encodeURIComponent(moduleId)}`;
  const busy = status === "checking" || status === "starting";

  return (
    <section aria-busy={busy} aria-labelledby="validation-title" className="webxr-spike">
      <h2 id="validation-title">{currentModule?.name ?? "Validación WebXR multiobjeto"}</h2>

      <p className="webxr-warning" role="note">
        Validación experimental de rendimiento WebXR multiobjeto. Las posiciones y giros no se
        persisten.
      </p>

      {status === "checking" ? <p role="status">Comprobando soporte WebXR immersive-ar…</p> : null}

      {status === "unsupported" ? (
        <div className="catalog-state catalog-error">
          <p className="auth-error" role="alert">
            Este navegador o dispositivo no permite ejecutar sesiones WebXR immersive-ar con
            hit-test.
          </p>
          <p className="page-lead">
            Puedes interactuar con el modelo en 3D o usar visores nativos compatibles en el visor
            individual.
          </p>
          <Link className="secondary-button" href={individualViewerHref}>
            Ir al visor 3D individual
          </Link>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="catalog-state catalog-error">
          <p className="auth-error" role="alert">{message}</p>
          <Link className="secondary-link" href={individualViewerHref}>
            Volver al visor individual
          </Link>
        </div>
      ) : null}

      <div className="webxr-stage" data-testid="webxr-validation-stage" ref={stageRef} />

      <div className="webxr-overlay" ref={overlayRef}>
        <div className="webxr-actions">
          {status === "ready" || status === "error" ? (
            <button
              className="auth-submit"
              disabled={!currentModule}
              onClick={start}
              type="button"
            >
              Iniciar sesión AR
            </button>
          ) : null}

          {status === "starting" ? <p role="status">Iniciando cámara y superficie…</p> : null}

          {status === "running" ? (
            <>
              <button
                className="secondary-button"
                onClick={() => runtimeRef.current?.add()}
                type="button"
              >
                + Añadir (retícula)
              </button>
              <button
                aria-label="Girar 15 grados a la izquierda"
                className="secondary-button"
                onClick={() => runtimeRef.current?.rotate(-15)}
                type="button"
              >
                −15°
              </button>
              <button
                aria-label="Girar 15 grados a la derecha"
                className="secondary-button"
                onClick={() => runtimeRef.current?.rotate(15)}
                type="button"
              >
                +15°
              </button>
              <button
                className="secondary-button"
                onClick={() => runtimeRef.current?.reset()}
                type="button"
              >
                Reiniciar
              </button>
              <button
                className="secondary-button"
                onClick={() => void runtimeRef.current?.end()}
                type="button"
              >
                Terminar sesión
              </button>
            </>
          ) : null}
        </div>

        <div className="webxr-target-selector">
          <label htmlFor="target-count-select">Cantidad objetivo de prueba:</label>
          <div className="webxr-target-buttons" id="target-count-select">
            {[1, 5, 10, 20].map((count) => (
              <button
                className={
                  selectedTargetCount === count ? "secondary-button active" : "secondary-button"
                }
                key={count}
                onClick={() => handleTargetChange(count)}
                type="button"
              >
                {count} {count === 1 ? "objeto" : "objetos"}
              </button>
            ))}
          </div>
        </div>

        <dl aria-label="Panel de diagnóstico WebXR" className="webxr-diagnostics">
          <div>
            <dt>User Agent</dt>
            <dd>{platform}</dd>
          </div>
          <div>
            <dt>Funciones concedidas</dt>
            <dd>{diagnostics.grantedFeatures}</dd>
          </div>
          <div>
            <dt>DOM overlay</dt>
            <dd>{diagnostics.domOverlay ? "activo" : "no disponible"}</dd>
          </div>
          <div>
            <dt>Objetos en escena</dt>
            <dd>{diagnostics.objectCount} (objetivo: {selectedTargetCount})</dd>
          </div>
          <div>
            <dt>FPS (actual / mín / prom)</dt>
            <dd>
              {diagnostics.fpsCurrent > 0
                ? `${diagnostics.fpsCurrent} / ${diagnostics.fpsMin} / ${diagnostics.fpsAverage}`
                : "calculando…"}
            </dd>
          </div>
          <div>
            <dt>Memoria estimada</dt>
            <dd>{diagnostics.memory}</dd>
          </div>
          <div>
            <dt>Activos Flyweight</dt>
            <dd>{diagnostics.activosFlyweight}</dd>
          </div>
          <div>
            <dt>Renderer info</dt>
            <dd>
              geom: {diagnostics.renderInfo.geometries} | tex: {diagnostics.renderInfo.textures} | calls: {diagnostics.renderInfo.calls} | tri: {diagnostics.renderInfo.triangles}
            </dd>
          </div>
          <div>
            <dt>Fallos registrados</dt>
            <dd>{diagnostics.failures}</dd>
          </div>
          <div>
            <dt>Último evento</dt>
            <dd>{diagnostics.lastEvent}</dd>
          </div>
        </dl>

        {status === "running" ? (
          <div className="webxr-export-action">
            <button className="secondary-button" onClick={copyDiagnostics} type="button">
              {copied ? "¡Diagnóstico copiado!" : "Copiar diagnóstico JSON"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
