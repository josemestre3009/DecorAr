import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import {
  MAX_NIVELES_GRUPO,
  type ComponenteDecorativo,
  type ComponenteDecorativoPadre,
} from "./decorative-component";
import type { ModuloDecoracion } from "./decoration-module";

export const MAX_LONGITUD_NOMBRE_GRUPO = 80;

/** Regla única del nombre de un grupo: texto recortado de 1 a 80 caracteres. */
export function validarNombreGrupo(nombre: unknown): Result<string, DomainError> {
  const nombreLimpio = typeof nombre === "string" ? nombre.trim() : "";
  if (nombreLimpio.length === 0 || nombreLimpio.length > MAX_LONGITUD_NOMBRE_GRUPO) {
    return err(
      new DomainError(
        "package.invalid_group_name",
        `El nombre del grupo debe tener entre 1 y ${MAX_LONGITUD_NOMBRE_GRUPO} caracteres`,
      ),
    );
  }

  return ok(nombreLimpio);
}

/**
 * Compuesto del Composite: un grupo decorativo (p. ej. "Zona de bienvenida")
 * que contiene hojas y otros grupos. No tiene precio ni área propios: suma
 * recursivamente los de sus hijos. Rechaza ciclos y más de tres niveles.
 */
export class ModuloCompuesto implements ComponenteDecorativoPadre {
  private _padre: ComponenteDecorativoPadre | null = null;
  private readonly _hijos: ComponenteDecorativo[] = [];

  private constructor(
    private readonly _id: string,
    private _nombre: string,
  ) {}

  static crear(id: string, nombre: string): Result<ModuloCompuesto, DomainError> {
    if (typeof id !== "string" || id.trim().length === 0) {
      return err(new DomainError("package.invalid_group", "Identificador de grupo inválido"));
    }

    const nombreLimpio = validarNombreGrupo(nombre);
    if (!nombreLimpio.ok) {
      return err(nombreLimpio.error);
    }

    return ok(new ModuloCompuesto(id.trim(), nombreLimpio.value));
  }

  get id(): string {
    return this._id;
  }

  get nombre(): string {
    return this._nombre;
  }

  get padre(): ComponenteDecorativoPadre | null {
    return this._padre;
  }

  get hijos(): readonly ComponenteDecorativo[] {
    return [...this._hijos];
  }

  /**
   * Agrega un hijo validando el árbol antes de tocarlo: un componente que ya
   * tiene grupo, un ciclo (el hijo es este grupo o uno de sus ancestros) o un
   * cuarto nivel de grupos se rechazan sin modificar nada.
   */
  agregar(hijo: ComponenteDecorativo): Result<void, DomainError> {
    if (hijo.contiene(this)) {
      return err(
        new DomainError(
          "package.group_cycle",
          `No se puede agregar "${hijo.nombre}" dentro de "${this._nombre}": formaría un ciclo.`,
        ),
      );
    }

    if (hijo.padre !== null) {
      return err(
        new DomainError(
          "package.component_already_grouped",
          `"${hijo.nombre}" ya pertenece a otro grupo.`,
        ),
      );
    }

    const nivelMasProfundo = this.nivel() + hijo.profundidad();
    if (nivelMasProfundo > MAX_NIVELES_GRUPO) {
      return err(
        new DomainError(
          "package.group_depth_exceeded",
          `Los grupos admiten como máximo ${MAX_NIVELES_GRUPO} niveles; "${hijo.nombre}" quedaría en el nivel ${nivelMasProfundo}.`,
        ),
      );
    }

    this._hijos.push(hijo);
    hijo.asignarPadre(this);
    return ok(undefined);
  }

  /** Cambia el nombre con la misma regla de `crear`; uno inválido no modifica nada. */
  renombrar(nombre: string): Result<void, DomainError> {
    const nombreLimpio = validarNombreGrupo(nombre);
    if (!nombreLimpio.ok) {
      return err(nombreLimpio.error);
    }

    this._nombre = nombreLimpio.value;
    return ok(undefined);
  }

  /** Suelta todos los hijos directos (quedan sin padre) y los devuelve en orden. */
  soltarHijos(): ComponenteDecorativo[] {
    const hijos = this._hijos.splice(0, this._hijos.length);
    for (const hijo of hijos) {
      hijo.asignarPadre(null);
    }
    return hijos;
  }

  /** Quita, en cualquier nivel de este grupo, el componente con ese id. */
  remover(componenteId: string): boolean {
    const index = this._hijos.findIndex((hijo) => hijo.id === componenteId);
    if (index !== -1) {
      const [removido] = this._hijos.splice(index, 1);
      removido.asignarPadre(null);
      return true;
    }

    return this._hijos.some((hijo) => hijo instanceof ModuloCompuesto && hijo.remover(componenteId));
  }

  /** Busca este grupo o un subgrupo por id. */
  buscarGrupo(grupoId: string): ModuloCompuesto | null {
    if (this._id === grupoId) {
      return this;
    }

    for (const hijo of this._hijos) {
      if (hijo instanceof ModuloCompuesto) {
        const encontrado = hijo.buscarGrupo(grupoId);
        if (encontrado) {
          return encontrado;
        }
      }
    }

    return null;
  }

  nivel(): number {
    return this._padre ? this._padre.nivel() + 1 : 1;
  }

  calcularPrecio(): number {
    return this._hijos.reduce((total, hijo) => total + hijo.calcularPrecio(), 0);
  }

  calcularAreaM2(): number {
    return this._hijos.reduce((total, hijo) => total + hijo.calcularAreaM2(), 0);
  }

  obtenerModulos(): readonly ModuloDecoracion[] {
    return this._hijos.flatMap((hijo) => hijo.obtenerModulos());
  }

  profundidad(): number {
    return 1 + this._hijos.reduce((maximo, hijo) => Math.max(maximo, hijo.profundidad()), 0);
  }

  contiene(otro: ComponenteDecorativo): boolean {
    return otro === this || this._hijos.some((hijo) => hijo.contiene(otro));
  }

  copiar(): ModuloCompuesto {
    const copia = new ModuloCompuesto(this._id, this._nombre);
    for (const hijo of this._hijos) {
      const hijoCopiado = hijo.copiar();
      copia._hijos.push(hijoCopiado);
      hijoCopiado.asignarPadre(copia);
    }
    return copia;
  }

  asignarPadre(padre: ComponenteDecorativoPadre | null): void {
    this._padre = padre;
  }
}
