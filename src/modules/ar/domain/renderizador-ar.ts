import type { Activo3DCompartido } from "./activo-3d-compartido";
import type { CapacidadesAR } from "./capacidades-ar";

/** Superficie sobre la que se coloca el elemento (`ar-placement`). */
export type ColocacionAR = "floor" | "wall";

/** Valores de `ar-modes` de `<model-viewer>`. */
export type ModoAR = "quick-look" | "scene-viewer" | "webxr";

export type NombreRenderizador = "quick-look" | "scene-viewer" | "webxr" | "sin-ar";

/**
 * Configuración plana del visor. El dominio no conoce `<model-viewer>`: la
 * interfaz traduce cada campo a su atributo.
 */
export interface ConfiguracionVisor {
  readonly renderizador: NombreRenderizador;
  /** GLB: vista 3D en el navegador, Scene Viewer y WebXR. */
  readonly src: string;
  /** USDZ para AR Quick Look; `null` fuera de iOS. */
  readonly iosSrc: string | null;
  readonly poster: string | null;
  readonly alt: string;
  readonly ar: boolean;
  readonly arModes: readonly ModoAR[];
  readonly arPlacement: ColocacionAR;
  /** Siempre `fixed`: el modelo se muestra a escala real 1:1. */
  readonly arScale: "fixed";
  /** Enlaces para ver o descargar el modelo cuando no hay AR. */
  readonly descargas: { readonly glb: string; readonly usdz: string };
}

export interface PeticionPresentacion {
  readonly activo: Activo3DCompartido;
  readonly colocacion: ColocacionAR;
  readonly alt: string;
}

/**
 * Implementador del Bridge: cada plataforma AR sabe qué archivo y qué modo
 * necesita. Los elementos decorativos (ElementoAR) delegan aquí sin conocer la
 * plataforma, así que añadir un visor no obliga a tocar MesaAR, ArcoAR o PistaAR.
 */
export interface RenderizadorAR {
  readonly nombre: NombreRenderizador;
  soporta(capacidades: CapacidadesAR): boolean;
  configurar(peticion: PeticionPresentacion): ConfiguracionVisor;
}

function base(
  nombre: NombreRenderizador,
  { activo, alt, colocacion }: PeticionPresentacion,
): Omit<ConfiguracionVisor, "ar" | "arModes" | "iosSrc"> {
  return {
    alt,
    arPlacement: colocacion,
    arScale: "fixed",
    descargas: Object.freeze({ glb: activo.glbUrl, usdz: activo.usdzUrl }),
    poster: activo.posterUrl,
    renderizador: nombre,
    src: activo.glbUrl,
  };
}

/** iOS: AR Quick Look con el USDZ obligatorio. */
export class RenderizadorQuickLook implements RenderizadorAR {
  readonly nombre = "quick-look";

  soporta(capacidades: CapacidadesAR): boolean {
    return capacidades.plataforma === "ios";
  }

  configurar(peticion: PeticionPresentacion): ConfiguracionVisor {
    return Object.freeze({
      ...base(this.nombre, peticion),
      ar: true,
      arModes: Object.freeze<ModoAR[]>(["quick-look"]),
      iosSrc: peticion.activo.usdzUrl,
    });
  }
}

/**
 * Android: Scene Viewer con el GLB. Con `ar-scale="fixed"` se abre sin permitir
 * cambiar el tamaño. WebXR queda como respaldo si Scene Viewer no está.
 */
export class RenderizadorSceneViewer implements RenderizadorAR {
  readonly nombre = "scene-viewer";

  soporta(capacidades: CapacidadesAR): boolean {
    return capacidades.plataforma === "android";
  }

  configurar(peticion: PeticionPresentacion): ConfiguracionVisor {
    return Object.freeze({
      ...base(this.nombre, peticion),
      ar: true,
      arModes: Object.freeze<ModoAR[]>(["scene-viewer", "webxr"]),
      iosSrc: null,
    });
  }
}

/** Navegadores con WebXR `immersive-ar` fuera de iOS y Android. */
export class RenderizadorWebXR implements RenderizadorAR {
  readonly nombre = "webxr";

  soporta(capacidades: CapacidadesAR): boolean {
    return capacidades.plataforma === "otra" && capacidades.webxr;
  }

  configurar(peticion: PeticionPresentacion): ConfiguracionVisor {
    return Object.freeze({
      ...base(this.nombre, peticion),
      ar: true,
      arModes: Object.freeze<ModoAR[]>(["webxr"]),
      iosSrc: null,
    });
  }
}

/** Sin AR: vista 3D en el navegador y enlaces de descarga como alternativa. */
export class RenderizadorSinAR implements RenderizadorAR {
  readonly nombre = "sin-ar";

  soporta(): boolean {
    return true;
  }

  configurar(peticion: PeticionPresentacion): ConfiguracionVisor {
    return Object.freeze({
      ...base(this.nombre, peticion),
      ar: false,
      arModes: Object.freeze<ModoAR[]>([]),
      iosSrc: null,
    });
  }
}

/** Orden de preferencia; el último siempre aplica. */
export const RENDERIZADORES_AR: readonly RenderizadorAR[] = Object.freeze([
  new RenderizadorQuickLook(),
  new RenderizadorSceneViewer(),
  new RenderizadorWebXR(),
  new RenderizadorSinAR(),
]);

export function elegirRenderizador(
  capacidades: CapacidadesAR,
  renderizadores: readonly RenderizadorAR[] = RENDERIZADORES_AR,
): RenderizadorAR {
  return renderizadores.find((renderizador) => renderizador.soporta(capacidades)) ?? new RenderizadorSinAR();
}
