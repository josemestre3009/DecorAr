import type { ModuloDecoracion } from "./decoration-module";

/** Máximo de niveles de grupos anidados (docs/DecorAR.md §1.4 y §4.3). */
export const MAX_NIVELES_GRUPO = 3;

/**
 * Patrón Composite (docs/DecorAR.md §4.3): contrato común para un elemento
 * decorativo suelto (`ElementoDecorativo`, hoja) y para un grupo de elementos
 * (`ModuloCompuesto`, compuesto). Quien recorre el paquete calcula precio y
 * área igual en ambos casos, sin condicionales por nivel.
 */
export interface ComponenteDecorativo {
  readonly id: string;
  readonly nombre: string;
  /** Grupo que contiene a este componente, o `null` si está en la raíz del paquete. */
  readonly padre: ComponenteDecorativoPadre | null;
  /** Precio en COP: el de la hoja, o la suma recursiva de las hojas del grupo. */
  calcularPrecio(): number;
  /** Área en m²: la de la hoja, o la suma recursiva de las hojas del grupo. */
  calcularAreaM2(): number;
  /** Módulos de todas las hojas, recorriendo el árbol en profundidad. */
  obtenerModulos(): readonly ModuloDecoracion[];
  /** Niveles de grupos de este subárbol: 0 para una hoja, 1 para un grupo sin subgrupos. */
  profundidad(): number;
  /** Indica si `otro` es este componente o uno de sus descendientes. */
  contiene(otro: ComponenteDecorativo): boolean;
  /** Copia profunda con los mismos ids y sin padre. */
  copiar(): ComponenteDecorativo;
  /** Uso interno del Composite: sólo `ModuloCompuesto.agregar/remover` lo llama. */
  asignarPadre(padre: ComponenteDecorativoPadre | null): void;
}

/** Lo que un hijo necesita saber de su grupo para validar niveles y ciclos. */
export interface ComponenteDecorativoPadre extends ComponenteDecorativo {
  /** Nivel absoluto del grupo dentro del paquete: 1 en la raíz. */
  nivel(): number;
}
