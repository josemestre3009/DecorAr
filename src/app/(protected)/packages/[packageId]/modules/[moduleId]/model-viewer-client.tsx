"use client";

import { useCallback, useEffect, useState } from "react";

import type { ConfiguracionVisor } from "@/modules/ar/domain/renderizador-ar";

type ViewerStatus =
  | { readonly status: "library" }
  | { readonly status: "loading"; readonly progress: number }
  | { readonly status: "ready"; readonly canActivateAR: boolean }
  | { readonly status: "error" };

type ModelViewerClientProps = {
  readonly configuracion: ConfiguracionVisor;
  /** Clave del activo compartido (`assetId@vN`), visible como evidencia. */
  readonly assetKey: string;
  /** Registra `<model-viewer>`; inyectable en las pruebas. */
  readonly loadLibrary?: () => Promise<unknown>;
};

/**
 * El paquete define un custom element que usa `window` y WebGL: solo puede
 * cargarse en el navegador. Se importa dentro de un efecto, nunca en el
 * servidor (guía "Lazy Loading" de Next.js).
 */
const loadModelViewer = () => import("@google/model-viewer");

type ProgressDetail = { readonly totalProgress?: number };

const AR_RECHECK_MS = [300, 1500] as const;

/**
 * Qué puede hacer la persona cuando el visor no puede abrir AR. En iPhone,
 * Quick Look solo funciona en Safari (y en Chrome, Edge o Firefox de iOS):
 * dentro de WhatsApp, Instagram o la app de Google el navegador no lo ofrece.
 */
function unavailableHint(renderizador: ConfiguracionVisor["renderizador"]): string {
  switch (renderizador) {
    case "quick-look":
      return "Para verlo en tu espacio, abre esta página en Safari. En iPhone la realidad aumentada no funciona dentro de apps como WhatsApp, Instagram o la app de Google.";
    case "scene-viewer":
      return "Para verlo en tu espacio, abre esta página en Chrome y revisa que el celular tenga instalado «Servicios de Google Play para RA».";
    case "webxr":
      return "Este navegador no pudo iniciar la realidad aumentada.";
    case "sin-ar":
      return "Este dispositivo o navegador no tiene realidad aumentada.";
  }
}

/**
 * Atributos del visor que salen de la configuración del Bridge. Se escriben con
 * `setAttribute`: si `<model-viewer>` ya está registrado, React 19 asigna
 * `src`, `alt`, `poster`, `ar`, `loading` y `reveal` como propiedades y no
 * quedarían en el DOM, que es donde la E2E (DECOR-39) los verifica.
 */
function viewerAttributes(configuracion: ConfiguracionVisor): Record<string, string | null> {
  return {
    alt: configuracion.alt,
    ar: configuracion.ar ? "" : null,
    "ar-modes": configuracion.arModes.length > 0 ? configuracion.arModes.join(" ") : null,
    "ar-placement": configuracion.arPlacement,
    "ar-scale": configuracion.arScale,
    "ios-src": configuracion.iosSrc,
    loading: "lazy",
    poster: configuracion.poster,
    reveal: "auto",
    src: configuracion.src,
  };
}
type ArStatusDetail = { readonly status?: string };

export function ModelViewerClient({
  configuracion,
  assetKey,
  loadLibrary = loadModelViewer,
}: ModelViewerClientProps) {
  const [attempt, setAttempt] = useState(0);
  const [libraryReady, setLibraryReady] = useState(false);
  const [state, setState] = useState<ViewerStatus>({ status: "library" });
  const [arFailed, setArFailed] = useState(false);

  useEffect(() => {
    let active = true;

    loadLibrary()
      .then(() => {
        if (!active) return;
        setLibraryReady(true);
        setState({ progress: 0, status: "loading" });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [attempt, loadLibrary]);

  // Atributos y eventos se aplican cuando el elemento entra al DOM (ref
  // callback): con un efecto, un "load" muy rápido (modelo en caché) podría
  // perderse.
  const attachViewer = useCallback((element: HTMLElement | null) => {
    if (!element) return;

    for (const [name, value] of Object.entries(viewerAttributes(configuracion))) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }

    const onProgress = (event: Event) => {
      const total = (event as CustomEvent<ProgressDetail>).detail?.totalProgress ?? 0;

      setState((current) =>
        current.status === "loading"
          ? { progress: Math.min(1, Math.max(0, total)), status: "loading" }
          : current,
      );
    };
    // `<model-viewer>` decide el modo AR de forma asíncrona (WebXR consulta al
    // navegador), así que se vuelve a leer unos instantes después de cargar.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const readCanActivateAR = () =>
      (element as HTMLElement & { canActivateAR?: boolean }).canActivateAR === true;
    const onLoad = () => {
      setState({ canActivateAR: readCanActivateAR(), status: "ready" });

      for (const delay of AR_RECHECK_MS) {
        timers.push(
          setTimeout(() => {
            setState((current) =>
              current.status === "ready" && current.canActivateAR !== readCanActivateAR()
                ? { canActivateAR: readCanActivateAR(), status: "ready" }
                : current,
            );
          }, delay),
        );
      }
    };
    const onError = () => setState({ status: "error" });
    const onArStatus = (event: Event) => {
      setArFailed((event as CustomEvent<ArStatusDetail>).detail?.status === "failed");
    };

    element.addEventListener("progress", onProgress);
    element.addEventListener("load", onLoad);
    element.addEventListener("error", onError);
    element.addEventListener("ar-status", onArStatus);

    return () => {
      timers.forEach(clearTimeout);
      element.removeEventListener("progress", onProgress);
      element.removeEventListener("load", onLoad);
      element.removeEventListener("error", onError);
      element.removeEventListener("ar-status", onArStatus);
    };
  }, [configuracion]);

  function retry() {
    // Un elemento nuevo (otra `key`) vuelve a pedir el modelo desde cero.
    setLibraryReady(false);
    setArFailed(false);
    setState({ status: "library" });
    setAttempt((value) => value + 1);
  }

  const arUnavailable =
    !configuracion.ar || (state.status === "ready" && !state.canActivateAR);

  return (
    <div className="ar-viewer">
      <div className="ar-stage">
        {libraryReady && state.status !== "error" ? (
          <model-viewer
            camera-controls
            className="ar-model"
            data-asset-key={assetKey}
            data-renderer={configuracion.renderizador}
            data-testid="model-viewer"
            key={attempt}
            ref={attachViewer}
            shadow-intensity="1"
            touch-action="pan-y"
          >
            {configuracion.ar ? (
              <button
                className="auth-submit ar-launch"
                data-testid="ar-launch"
                slot="ar-button"
                type="button"
              >
                Ver en tu espacio
              </button>
            ) : null}
          </model-viewer>
        ) : null}

        {state.status === "library" ? (
          <p className="catalog-state ar-overlay" role="status">
            <span aria-hidden="true" className="spinner" />
            Preparando el visor 3D…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="catalog-state catalog-error ar-overlay">
            <p className="auth-error" role="alert">
              No pudimos cargar el modelo 3D. Revisa tu conexión e inténtalo de nuevo.
            </p>
            <button className="secondary-button" onClick={retry} type="button">
              Reintentar
            </button>
          </div>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div className="ar-progress">
          <label htmlFor="ar-progress-bar">Cargando modelo 3D</label>
          <progress id="ar-progress-bar" max={100} value={Math.round(state.progress * 100)}>
            {Math.round(state.progress * 100)} %
          </progress>
        </div>
      ) : null}

      {state.status !== "error" && arUnavailable ? (
        <div className="ar-notice" data-testid="ar-unsupported" role="note">
          <p>{unavailableHint(configuracion.renderizador)}</p>
          <p>Mientras tanto puedes girar el modelo en 3D o abrirlo en otra app:</p>
          <ul className="ar-downloads">
            <li>
              <a download href={configuracion.descargas.glb} rel="noopener">
                Modelo GLB (Android y web)
              </a>
            </li>
            <li>
              <a download href={configuracion.descargas.usdz} rel="noopener">
                Modelo USDZ (iPhone y iPad)
              </a>
            </li>
          </ul>
        </div>
      ) : null}

      {/* Solo cuando el botón "Ver en tu espacio" existe de verdad. */}
      {state.status === "ready" && configuracion.ar && state.canActivateAR ? (
        <ol className="ar-steps" data-testid="ar-steps">
          <li>Toca «Ver en tu espacio» y apunta la cámara al piso.</li>
          <li>Cuando aparezca el modelo, arrástralo con un dedo para moverlo.</li>
          <li>Gíralo con dos dedos. El tamaño se mantiene fijo.</li>
        </ol>
      ) : null}

      {arFailed ? (
        <p className="auth-error" role="alert">
          No se pudo iniciar la realidad aumentada. Apunta la cámara a una superficie con buena
          luz e inténtalo de nuevo.
        </p>
      ) : null}
    </div>
  );
}
