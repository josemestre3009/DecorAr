import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { crearActivo3DCompartido } from "@/modules/ar/domain/activo-3d-compartido";
import {
  RenderizadorQuickLook,
  RenderizadorSceneViewer,
  RenderizadorSinAR,
} from "@/modules/ar/domain/renderizador-ar";

import { ModelViewerClient } from "./model-viewer-client";

const activo = (() => {
  const resultado = crearActivo3DCompartido({
    assetId: "mesa",
    depthM: 1.19,
    glbUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v2/mesa.glb",
    heightM: 0.94,
    posterUrl: "https://res.cloudinary.com/demo/image/upload/decorar/mesa/v2/mesa-poster.webp",
    usdzUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v2/mesa.usdz",
    version: 2,
    widthM: 2,
  });
  if (!resultado.ok) throw resultado.error;

  return resultado.value;
})();

const PETICION = { activo, alt: "Mesa a escala real", colocacion: "floor" } as const;

// En jsdom `<model-viewer>` no se registra: se comprueban los atributos que
// recibe y se simulan los eventos que emitiría el componente real.
const library = () => vi.fn<() => Promise<unknown>>().mockResolvedValue({});

async function renderViewer(configuracion = new RenderizadorQuickLook().configurar(PETICION)) {
  const loadLibrary = library();

  render(<ModelViewerClient assetKey="mesa@v2" configuracion={configuracion} loadLibrary={loadLibrary} />);

  const viewer = await screen.findByTestId("model-viewer");

  return { loadLibrary, viewer };
}

describe("ModelViewerClient", () => {
  it("muestra que prepara el visor mientras carga la librería solo en el navegador", async () => {
    const { loadLibrary } = await renderViewer();

    expect(loadLibrary).toHaveBeenCalledTimes(1);
  });

  it("configura model-viewer para Quick Look: USDZ, escala fija, piso, poster, lazy y controles", async () => {
    const { viewer } = await renderViewer();

    expect(viewer.tagName.toLowerCase()).toBe("model-viewer");
    expect(viewer).toHaveAttribute("src", activo.glbUrl);
    expect(viewer).toHaveAttribute("ios-src", activo.usdzUrl);
    expect(viewer).toHaveAttribute("ar", "");
    expect(viewer).toHaveAttribute("ar-modes", "quick-look");
    expect(viewer).toHaveAttribute("ar-scale", "fixed");
    expect(viewer).toHaveAttribute("ar-placement", "floor");
    expect(viewer).toHaveAttribute("poster", activo.posterUrl as string);
    expect(viewer).toHaveAttribute("alt", "Mesa a escala real");
    expect(viewer).toHaveAttribute("loading", "lazy");
    expect(viewer).toHaveAttribute("camera-controls", "");
    expect(viewer).toHaveAttribute("data-asset-key", "mesa@v2");
    expect(viewer).toHaveAttribute("data-renderer", "quick-look");
    expect(within(viewer).getByTestId("ar-launch")).toHaveAttribute("slot", "ar-button");
  });

  it("en Android sin AR recomienda Chrome y los Servicios de Google Play para RA", async () => {
    const { viewer } = await renderViewer(new RenderizadorSceneViewer().configurar(PETICION));

    Object.defineProperty(viewer, "canActivateAR", { value: false });
    act(() => {
      viewer.dispatchEvent(new Event("load"));
    });

    expect(screen.getByTestId("ar-unsupported")).toHaveTextContent("Servicios de Google Play para RA");
    expect(screen.queryByTestId("ar-steps")).not.toBeInTheDocument();
  });

  it("configura Scene Viewer con GLB y sin USDZ", async () => {
    const { viewer } = await renderViewer(new RenderizadorSceneViewer().configurar(PETICION));

    expect(viewer).toHaveAttribute("ar-modes", "scene-viewer webxr");
    expect(viewer).not.toHaveAttribute("ios-src");
    expect(viewer).toHaveAttribute("data-renderer", "scene-viewer");
  });

  it("muestra el progreso de carga del modelo", async () => {
    const { viewer } = await renderViewer();

    act(() => {
      viewer.dispatchEvent(new CustomEvent("progress", { detail: { totalProgress: 0.42 } }));
    });

    expect(screen.getByLabelText("Cargando modelo 3D")).toHaveAttribute("value", "42");
  });

  it("al cargar con AR disponible no muestra el aviso de incompatibilidad", async () => {
    const { viewer } = await renderViewer();

    Object.defineProperty(viewer, "canActivateAR", { value: true });
    act(() => {
      viewer.dispatchEvent(new Event("load"));
    });

    expect(screen.queryByLabelText("Cargando modelo 3D")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ar-unsupported")).not.toBeInTheDocument();
    expect(screen.getByTestId("ar-steps")).toHaveTextContent("Toca «Ver en tu espacio»");
  });

  it("vuelve a comprobar la AR después de cargar: model-viewer la decide de forma asíncrona", async () => {
    const { viewer } = await renderViewer();
    let canActivateAR = false;

    Object.defineProperty(viewer, "canActivateAR", { get: () => canActivateAR });
    act(() => {
      viewer.dispatchEvent(new Event("load"));
    });

    expect(screen.getByTestId("ar-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("ar-steps")).not.toBeInTheDocument();

    canActivateAR = true;

    expect(await screen.findByTestId("ar-steps")).toBeInTheDocument();
    expect(screen.queryByTestId("ar-unsupported")).not.toBeInTheDocument();
  });

  it("si el dispositivo no puede abrir AR, ofrece la vista 3D y la descarga", async () => {
    const { viewer } = await renderViewer();

    Object.defineProperty(viewer, "canActivateAR", { value: false });
    act(() => {
      viewer.dispatchEvent(new Event("load"));
    });

    const aviso = screen.getByTestId("ar-unsupported");
    // En iPhone, Quick Look solo funciona en Safari o navegadores compatibles,
    // no dentro de apps como WhatsApp: el aviso lo dice en lugar de dar pasos.
    expect(aviso).toHaveTextContent("abre esta página en Safari");
    expect(screen.queryByTestId("ar-steps")).not.toBeInTheDocument();
    expect(within(aviso).getByRole("link", { name: /GLB/ })).toHaveAttribute("href", activo.glbUrl);
    expect(within(aviso).getByRole("link", { name: /USDZ/ })).toHaveAttribute("href", activo.usdzUrl);
  });

  it("sin AR no muestra el botón y avisa desde el inicio", async () => {
    const { viewer } = await renderViewer(new RenderizadorSinAR().configurar(PETICION));

    expect(viewer).not.toHaveAttribute("ar");
    expect(viewer).not.toHaveAttribute("ar-modes");
    expect(screen.queryByTestId("ar-launch")).not.toBeInTheDocument();
    expect(screen.getByTestId("ar-unsupported")).toHaveTextContent("no tiene realidad aumentada");
    // Escala y colocación siguen fijadas para cualquier visor.
    expect(viewer).toHaveAttribute("ar-scale", "fixed");
  });

  it("muestra el error de carga y reintenta con un visor nuevo", async () => {
    const { loadLibrary, viewer } = await renderViewer();

    act(() => {
      viewer.dispatchEvent(new Event("error"));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el modelo 3D.");
    expect(screen.queryByTestId("model-viewer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    const nuevo = await screen.findByTestId("model-viewer");
    expect(nuevo).not.toBe(viewer);
    expect(loadLibrary).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si la librería no carga, muestra el error y permite reintentar", async () => {
    const loadLibrary = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValue({});
    const configuracion = new RenderizadorQuickLook().configurar(PETICION);

    render(<ModelViewerClient assetKey="mesa@v2" configuracion={configuracion} loadLibrary={loadLibrary} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar el modelo 3D.");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByTestId("model-viewer")).toBeInTheDocument();
  });

  it("avisa si la sesión AR falla", async () => {
    const { viewer } = await renderViewer();

    act(() => {
      viewer.dispatchEvent(new CustomEvent("ar-status", { detail: { status: "failed" } }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo iniciar la realidad aumentada.");
  });
});
