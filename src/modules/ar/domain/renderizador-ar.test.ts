import { describe, expect, it } from "vitest";

import { crearActivo3DCompartido } from "./activo-3d-compartido";
import type { CapacidadesAR } from "./capacidades-ar";
import {
  elegirRenderizador,
  RenderizadorQuickLook,
  RenderizadorSceneViewer,
  RenderizadorSinAR,
  RenderizadorWebXR,
  RENDERIZADORES_AR,
  type PeticionPresentacion,
} from "./renderizador-ar";

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

const PETICION: PeticionPresentacion = { activo, alt: "Mesa", colocacion: "floor" };

const IOS: CapacidadesAR = { plataforma: "ios", webxr: false };
const ANDROID: CapacidadesAR = { plataforma: "android", webxr: true };
const ESCRITORIO_XR: CapacidadesAR = { plataforma: "otra", webxr: true };
const ESCRITORIO: CapacidadesAR = { plataforma: "otra", webxr: false };

describe("selección del renderizador (Bridge)", () => {
  it.each([
    ["iOS", IOS, "quick-look"],
    ["Android", ANDROID, "scene-viewer"],
    ["Android sin WebXR", { plataforma: "android", webxr: false } as const, "scene-viewer"],
    ["navegador con WebXR", ESCRITORIO_XR, "webxr"],
    ["navegador sin AR", ESCRITORIO, "sin-ar"],
    ["iOS aunque declare WebXR", { plataforma: "ios", webxr: true } as const, "quick-look"],
  ])("%s usa %s", (_caso, capacidades, esperado) => {
    expect(elegirRenderizador(capacidades).nombre).toBe(esperado);
  });

  it("usa el renderizador sin AR si ninguna implementación aplica", () => {
    expect(elegirRenderizador(IOS, [new RenderizadorSceneViewer()]).nombre).toBe("sin-ar");
  });

  it("el orden por defecto termina en un renderizador que siempre aplica", () => {
    expect(RENDERIZADORES_AR.at(-1)?.soporta(ESCRITORIO)).toBe(true);
  });
});

describe("configuración de cada plataforma", () => {
  it("Quick Look entrega el USDZ obligatorio y solo el modo quick-look", () => {
    const configuracion = new RenderizadorQuickLook().configurar(PETICION);

    expect(configuracion).toMatchObject({
      ar: true,
      arModes: ["quick-look"],
      iosSrc: activo.usdzUrl,
      renderizador: "quick-look",
      src: activo.glbUrl,
    });
  });

  it("Scene Viewer entrega el GLB y deja WebXR como respaldo", () => {
    const configuracion = new RenderizadorSceneViewer().configurar(PETICION);

    expect(configuracion).toMatchObject({
      ar: true,
      arModes: ["scene-viewer", "webxr"],
      iosSrc: null,
      src: activo.glbUrl,
    });
  });

  it("WebXR entrega el GLB con el modo webxr", () => {
    expect(new RenderizadorWebXR().configurar(PETICION)).toMatchObject({
      ar: true,
      arModes: ["webxr"],
      src: activo.glbUrl,
    });
  });

  it("sin AR mantiene la vista 3D y ofrece descargar GLB y USDZ", () => {
    expect(new RenderizadorSinAR().configurar(PETICION)).toMatchObject({
      ar: false,
      arModes: [],
      descargas: { glb: activo.glbUrl, usdz: activo.usdzUrl },
      src: activo.glbUrl,
    });
  });

  it.each(RENDERIZADORES_AR.map((renderizador) => [renderizador.nombre, renderizador] as const))(
    "%s fija escala 1:1, colocación, poster y texto alternativo",
    (_nombre, renderizador) => {
      const configuracion = renderizador.configurar({ ...PETICION, colocacion: "wall" });

      expect(configuracion.arScale).toBe("fixed");
      expect(configuracion.arPlacement).toBe("wall");
      expect(configuracion.poster).toBe(activo.posterUrl);
      expect(configuracion.alt).toBe("Mesa");
      expect(Object.isFrozen(configuracion)).toBe(true);
      expect(Object.isFrozen(configuracion.arModes)).toBe(true);
    },
  );
});
