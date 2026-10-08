import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

import type { InstanciaDecorativa } from "./instancia-decorativa";
import type { ColocacionAR, ConfiguracionVisor, RenderizadorAR } from "./renderizador-ar";

export type TipoElementoAR = "mesa" | "arco" | "pista";

const METROS = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/**
 * Abstracción del Bridge. Un elemento decorativo sabe qué es y sobre qué
 * superficie va, pero no cómo se muestra en cada plataforma: eso lo delega en
 * su `RenderizadorAR`. Cambiar de iOS a Android cambia el renderizador, nunca
 * el elemento.
 */
export abstract class ElementoAR {
  abstract readonly tipo: TipoElementoAR;
  abstract readonly colocacion: ColocacionAR;
  /** Cómo se nombra el elemento en el texto alternativo. */
  protected abstract readonly descripcion: string;

  protected constructor(
    readonly nombre: string,
    readonly instancia: InstanciaDecorativa,
    private readonly renderizador: RenderizadorAR,
  ) {}

  get plataforma(): RenderizadorAR["nombre"] {
    return this.renderizador.nombre;
  }

  presentar(): ConfiguracionVisor {
    return this.renderizador.configurar({
      activo: this.instancia.activo,
      alt: this.textoAlternativo(),
      colocacion: this.colocacion,
    });
  }

  /** Describe medidas reales: la AR las respeta porque la escala es fija. */
  textoAlternativo(): string {
    const { widthM, heightM, depthM } = this.instancia.activo;

    return (
      `${this.nombre}: ${this.descripcion} de ${METROS.format(widthM)} m de ancho, ` +
      `${METROS.format(heightM)} m de alto y ${METROS.format(depthM)} m de fondo, a escala real.`
    );
  }
}

/** Mesa: mueble que se apoya en el piso. */
export class MesaAR extends ElementoAR {
  readonly tipo = "mesa";
  readonly colocacion = "floor";
  protected readonly descripcion = "mesa decorativa";

  constructor(nombre: string, instancia: InstanciaDecorativa, renderizador: RenderizadorAR) {
    super(nombre, instancia, renderizador);
  }
}

/**
 * Arco: estructura de pie (2,4 m de alto) que se apoya en el piso, no se cuelga
 * de una pared.
 */
export class ArcoAR extends ElementoAR {
  readonly tipo = "arco";
  readonly colocacion = "floor";
  protected readonly descripcion = "arco decorativo";

  constructor(nombre: string, instancia: InstanciaDecorativa, renderizador: RenderizadorAR) {
    super(nombre, instancia, renderizador);
  }
}

/** Pista: plataforma de baile que se extiende sobre el piso. */
export class PistaAR extends ElementoAR {
  readonly tipo = "pista";
  readonly colocacion = "floor";
  protected readonly descripcion = "pista de baile";

  constructor(nombre: string, instancia: InstanciaDecorativa, renderizador: RenderizadorAR) {
    super(nombre, instancia, renderizador);
  }
}

/** Elige la abstracción refinada según el `assetId` del catálogo. */
export function crearElementoAR(
  nombre: string,
  instancia: InstanciaDecorativa,
  renderizador: RenderizadorAR,
): Result<ElementoAR, DomainError> {
  switch (instancia.activo.assetId) {
    case "mesa":
      return ok(new MesaAR(nombre, instancia, renderizador));
    case "arco":
      return ok(new ArcoAR(nombre, instancia, renderizador));
    case "pista":
      return ok(new PistaAR(nombre, instancia, renderizador));
    default:
      return err(
        new DomainError(
          "ar.unsupported_element",
          "Este módulo todavía no está disponible en realidad aumentada.",
        ),
      );
  }
}
