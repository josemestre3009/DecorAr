"use client";

import { useEffect, useRef, useState } from "react";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";

import { fetchCatalogModule } from "../../../../_lib/catalog-client";
import type { WebXRDiagnostics, WebXRRuntime } from "./webxr-runtime";

type Status = "checking" | "unsupported" | "ready" | "starting" | "running" | "error";

type RuntimeStarter = typeof import("./webxr-runtime")["startWebXRRuntime"];

type WebXRSpikeProps = Readonly<{
  fetcher?: typeof fetch;
  moduleId: string;
  startRuntime?: RuntimeStarter;
  xr?: Pick<XRSystem, "isSessionSupported">;
}>;

const EMPTY_DIAGNOSTICS: WebXRDiagnostics = {
  domOverlay: false,
  fps: 0,
  grantedFeatures: "ninguna",
  lastEvent: "ninguno",
  objectCount: 0,
};

const loadRuntime: RuntimeStarter = async (options) => {
  const runtime = await import("./webxr-runtime");
  return runtime.startWebXRRuntime(options);
};

export function WebXRSpike({ fetcher, moduleId, startRuntime = loadRuntime, xr }: WebXRSpikeProps) {
  const [status, setStatus] = useState<Status>("checking");
  const [module, setModule] = useState<CatalogModuleDto | null>(null);
  const [message, setMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState(EMPTY_DIAGNOSTICS);
  const [platform, setPlatform] = useState("pendiente");
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<WebXRRuntime | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const xrSystem = xr ?? navigator.xr;

    Promise.all([
      fetchCatalogModule(moduleId, fetcher, controller.signal),
      xrSystem?.isSessionSupported("immersive-ar") ?? Promise.resolve(false),
    ]).then(([result, supported]) => {
      if (controller.signal.aborted) return;
      setPlatform(navigator.userAgent);
      if (!result.ok) {
        setMessage(result.error.message);
        setStatus("error");
      } else if (!supported) {
        setModule(result.value);
        setStatus("unsupported");
      } else {
        setModule(result.value);
        setStatus("ready");
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setMessage("No se pudieron comprobar las capacidades del dispositivo.");
        setStatus("error");
      }
    });

    return () => {
      controller.abort();
      void runtimeRef.current?.end();
    };
  }, [fetcher, moduleId, xr]);

  async function start() {
    if (!module || !stageRef.current || !overlayRef.current) return;
    setStatus("starting");
    setMessage("");
    try {
      runtimeRef.current = await startRuntime({
        assetUrl: module.glbUrl,
        container: stageRef.current,
        overlayRoot: overlayRef.current,
        onDiagnostics: setDiagnostics,
        onEnd: () => {
          runtimeRef.current = null;
          setDiagnostics(EMPTY_DIAGNOSTICS);
          setStatus("ready");
        },
      });
      setStatus("running");
    } catch {
      setMessage("No se pudo iniciar la sesión AR. Revisa permisos, ARCore y la conexión HTTPS.");
      setStatus("error");
    }
  }

  const busy = status === "checking" || status === "starting";

  return (
    <section aria-busy={busy} aria-labelledby="spike-title" className="webxr-spike">
      <h2 id="spike-title">{module?.name ?? "Escena multiobjeto"}</h2>
      <p className="webxr-warning" role="note">
        Experimento temporal. Las posiciones y giros se eliminan al cerrar o reiniciar la sesión.
      </p>

      {status === "checking" ? <p role="status">Comprobando WebXR y el activo…</p> : null}
      {status === "unsupported" ? (
        <p className="auth-error" role="alert">
          Este navegador no permite ejecutar el spike WebXR immersive-ar.
        </p>
      ) : null}
      {status === "error" ? <p className="auth-error" role="alert">{message}</p> : null}

      <div className="webxr-stage" data-testid="webxr-stage" ref={stageRef} />
      <div className="webxr-overlay" ref={overlayRef}>
        <div className="webxr-actions">
          {status === "ready" || status === "error" ? (
            <button className="auth-submit" disabled={!module} onClick={start} type="button">
              Iniciar prueba AR
            </button>
          ) : null}
          {status === "starting" ? <p role="status">Iniciando cámara y superficie…</p> : null}
          {status === "running" ? (
            <>
              <button className="secondary-button" onClick={() => runtimeRef.current?.add()} type="button">Añadir objeto</button>
              <button aria-label="Girar 15 grados a la izquierda" className="secondary-button" onClick={() => runtimeRef.current?.rotate(-15)} type="button">−15°</button>
              <button aria-label="Girar 15 grados a la derecha" className="secondary-button" onClick={() => runtimeRef.current?.rotate(15)} type="button">+15°</button>
              <button className="secondary-button" onClick={() => void runtimeRef.current?.end()} type="button">Terminar sesión</button>
            </>
          ) : null}
        </div>

        <dl aria-label="Diagnóstico WebXR" className="webxr-diagnostics">
          <div><dt>Plataforma</dt><dd>{platform}</dd></div>
          <div><dt>Funciones</dt><dd>{diagnostics.grantedFeatures}</dd></div>
          <div><dt>DOM overlay</dt><dd>{diagnostics.domOverlay ? "sí" : "no"}</dd></div>
          <div><dt>Último evento</dt><dd>{diagnostics.lastEvent}</dd></div>
          <div><dt>Objetos</dt><dd>{diagnostics.objectCount}/3</dd></div>
          <div><dt>FPS aproximados</dt><dd>{diagnostics.fps}</dd></div>
        </dl>
      </div>
    </section>
  );
}
