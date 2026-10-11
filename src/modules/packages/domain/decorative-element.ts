import type { ComponenteDecorativo, ComponenteDecorativoPadre } from "./decorative-component";
import type { ModuloDecoracion } from "./decoration-module";

/** Hoja del Composite: un módulo del catálogo colocado en el paquete. */
export class ElementoDecorativo implements ComponenteDecorativo {
  private _padre: ComponenteDecorativoPadre | null = null;

  constructor(private readonly _modulo: ModuloDecoracion) {}

  get id(): string {
    return this._modulo.id;
  }

  get nombre(): string {
    return this._modulo.nombre;
  }

  get modulo(): ModuloDecoracion {
    return this._modulo;
  }

  get padre(): ComponenteDecorativoPadre | null {
    return this._padre;
  }

  calcularPrecio(): number {
    return this._modulo.precio;
  }

  calcularAreaM2(): number {
    return this._modulo.ocupaM2;
  }

  obtenerModulos(): readonly ModuloDecoracion[] {
    return [this._modulo];
  }

  profundidad(): number {
    return 0;
  }

  contiene(otro: ComponenteDecorativo): boolean {
    return otro === this;
  }

  copiar(): ElementoDecorativo {
    return new ElementoDecorativo(this._modulo);
  }

  asignarPadre(padre: ComponenteDecorativoPadre | null): void {
    this._padre = padre;
  }
}
