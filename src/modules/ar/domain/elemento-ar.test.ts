import { describe, expect, it } from "vitest";

import { crearActivo3DCompartido, type DatosActivo3D } from "./activo-3d-compartido";
import { ArcoAR, crearElementoAR, MesaAR, PistaAR } from "./elemento-ar";
import { InstanciaDecorativa } from "./instancia-decorativa";
import {
  RenderizadorQuickLook,
  RenderizadorSceneViewer,
  type ConfiguracionVisor,
  type PeticionPresentacion,
  type RenderizadorAR,
} from "./renderizador-ar";

function instanciaDe(datos: Partial<DatosActivo3D> & { assetId: string }) {
  const activo = crearActivo3DCompartido({
    depthM: 1.19,
    glbUrl: `https://res.cloudinary.com/demo/raw/upload/decorar/${datos.assetId}/v2/m.glb`,
    heightM: 0.94,
    posterUrl: null,
    usdzUrl: `https://res.cloudinary.com/demo/raw/upload/decorar/${datos.assetId}/v2/m.usdz`,
    version: 2,
    widthM: 2,
    ...datos,
  });
  if (!activo.ok) throw activo.error;

  const instancia = InstanciaDecorativa.crear(activo.value);
  if (!instancia.ok) throw instancia.error;

  return instancia.value;
}

/** Renderizador espía: registra lo que el elemento le delega. */
class RenderizadorEspia implements RenderizadorAR {
  readonly nombre = "webxr";
  readonly peticiones: PeticionPresentacion[] = [];

  soporta(): boolean {
    return true;
  }

  configurar(peticion: PeticionPresentacion): ConfiguracionVisor {
    this.peticiones.push(peticion);
    return new RenderizadorSceneViewer().configurar(peticion);
  }
}

describe("ElementoAR (abstracción del Bridge)", () => {
  it.each([
    ["mesa", MesaAR],
    ["arco", ArcoAR],
    ["pista", PistaAR],
  ] as const)("crea %s con su abstracción refinada", (assetId, Clase) => {
    const resultado = crearElementoAR("Nombre", instanciaDe({ assetId }), new RenderizadorQuickLook());

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.value).toBeInstanceOf(Clase);
    expect(resultado.value.tipo).toBe(assetId);
  });

  it("los tres módulos del MVP se colocan sobre el piso", () => {
    for (const assetId of ["mesa", "arco", "pista"]) {
      const elemento = crearElementoAR("X", instanciaDe({ assetId }), new RenderizadorQuickLook());
      expect(elemento.ok && elemento.value.colocacion).toBe("floor");
    }
  });

  it("rechaza un assetId sin elemento AR", () => {
    const resultado = crearElementoAR("Silla", instanciaDe({ assetId: "silla" }), new RenderizadorQuickLook());

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe("ar.unsupported_element");
  });

  it("delega la presentación en el renderizador con su activo y su colocación", () => {
    const espia = new RenderizadorEspia();
    const instancia = instanciaDe({ assetId: "arco" });
    const arco = new ArcoAR("Arco floral", instancia, espia);

    arco.presentar();

    expect(espia.peticiones).toHaveLength(1);
    expect(espia.peticiones[0]?.activo).toBe(instancia.activo);
    expect(espia.peticiones[0]?.colocacion).toBe("floor");
  });

  it("el mismo elemento cambia de plataforma sin cambiar su abstracción", () => {
    const instancia = instanciaDe({ assetId: "mesa" });
    const enIos = new MesaAR("Mesa", instancia, new RenderizadorQuickLook()).presentar();
    const enAndroid = new MesaAR("Mesa", instancia, new RenderizadorSceneViewer()).presentar();

    expect(enIos.renderizador).toBe("quick-look");
    expect(enIos.iosSrc).toBe(instancia.activo.usdzUrl);
    expect(enAndroid.renderizador).toBe("scene-viewer");
    expect(enAndroid.iosSrc).toBeNull();
    // Lo que define al elemento no depende de la plataforma.
    expect(enIos.arPlacement).toBe(enAndroid.arPlacement);
    expect(enIos.alt).toBe(enAndroid.alt);
    expect(enIos.src).toBe(enAndroid.src);
  });

  it("describe las medidas reales en el texto alternativo", () => {
    const pista = new PistaAR(
      "Pista LED",
      instanciaDe({ assetId: "pista", depthM: 4, heightM: 0.285, widthM: 4 }),
      new RenderizadorQuickLook(),
    );

    expect(pista.presentar().alt).toBe(
      "Pista LED: pista de baile de 4 m de ancho, 0,29 m de alto y 4 m de fondo, a escala real.",
    );
    expect(pista.plataforma).toBe("quick-look");
  });
});
