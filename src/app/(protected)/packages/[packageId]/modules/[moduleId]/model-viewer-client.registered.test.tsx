import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { crearActivo3DCompartido } from "@/modules/ar/domain/activo-3d-compartido";
import { RenderizadorQuickLook } from "@/modules/ar/domain/renderizador-ar";

import { ModelViewerClient } from "./model-viewer-client";

/**
 * Archivo aparte porque registra `<model-viewer>` para todo el entorno jsdom.
 * Reproduce lo que pasa en el navegador al volver a la vista 3D: el elemento ya
 * existe y tiene propiedades `src`, `ar`, `alt`... que React 19 asignaría como
 * propiedades en lugar de atributos.
 */
class FakeModelViewer extends HTMLElement {
  src = "";
  alt = "";
  poster = "";
  ar = false;
  loading = "auto";
  reveal = "auto";
}

beforeAll(() => {
  customElements.define("model-viewer", FakeModelViewer);
});

describe("ModelViewerClient con <model-viewer> ya registrado", () => {
  it("deja la configuración del Bridge como atributos verificables", async () => {
    const activo = crearActivo3DCompartido({
      assetId: "mesa",
      depthM: 1.19,
      glbUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v2/mesa.glb",
      heightM: 0.94,
      posterUrl: "https://res.cloudinary.com/demo/image/upload/decorar/mesa/v2/poster.webp",
      usdzUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v2/mesa.usdz",
      version: 2,
      widthM: 2,
    });
    if (!activo.ok) throw activo.error;

    const configuracion = new RenderizadorQuickLook().configurar({
      activo: activo.value,
      alt: "Mesa a escala real",
      colocacion: "floor",
    });

    render(
      <ModelViewerClient
        assetKey="mesa@v2"
        configuracion={configuracion}
        loadLibrary={() => Promise.resolve({})}
      />,
    );

    const viewer = await screen.findByTestId("model-viewer");

    expect(viewer).toBeInstanceOf(FakeModelViewer);
    expect(viewer).toHaveAttribute("src", activo.value.glbUrl);
    expect(viewer).toHaveAttribute("ios-src", activo.value.usdzUrl);
    expect(viewer).toHaveAttribute("alt", "Mesa a escala real");
    expect(viewer).toHaveAttribute("poster", activo.value.posterUrl as string);
    expect(viewer).toHaveAttribute("ar", "");
    expect(viewer).toHaveAttribute("ar-scale", "fixed");
    expect(viewer).toHaveAttribute("loading", "lazy");
    expect(viewer).toHaveAttribute("camera-controls", "");
  });
});
