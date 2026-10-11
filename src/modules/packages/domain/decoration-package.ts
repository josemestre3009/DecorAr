import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { ModuloCompuesto } from "./composite-module";
import { MAX_NIVELES_GRUPO, type ComponenteDecorativo } from "./decorative-component";
import { ElementoDecorativo } from "./decorative-element";
import type { ModuloDecoracion } from "./decoration-module";
import { isTipoEspacio, isValidCapacityM2, MAX_CAPACITY_M2, type TipoEspacio } from "./space-type";

export interface PaqueteDecoracionProps {
  readonly tipoEspacio: TipoEspacio;
  readonly capacidadM2: number;
  /** Módulos sueltos; cada uno se guarda como `ElementoDecorativo`. */
  readonly modulos?: readonly ModuloDecoracion[];
  /** Hojas y grupos ya armados (Composite). Se agregan después de `modulos`. */
  readonly componentes?: readonly ComponenteDecorativo[];
}

/**
 * Paquete armado por el Builder. Guarda sus elementos como
 * `ComponenteDecorativo` (Composite), así que área y presupuesto se calculan
 * igual para hojas sueltas y para grupos como "Zona de bienvenida".
 */
export class PaqueteDecoracion {
  private readonly _tipoEspacio: TipoEspacio;
  private readonly _capacidadM2: number;
  private readonly _componentes: ComponenteDecorativo[];

  private constructor(tipoEspacio: TipoEspacio, capacidadM2: number, componentes: ComponenteDecorativo[] = []) {
    this._tipoEspacio = tipoEspacio;
    this._capacidadM2 = capacidadM2;
    this._componentes = componentes;
  }

  public static create(props: PaqueteDecoracionProps): Result<PaqueteDecoracion, DomainError> {
    if (!isTipoEspacio(props.tipoEspacio)) {
      return err(
        new DomainError("package.invalid_space_type", `Tipo de espacio no soportado: ${String(props.tipoEspacio)}`),
      );
    }

    if (!isValidCapacityM2(props.capacidadM2)) {
      return err(
        new DomainError(
          "package.invalid_capacity",
          `La capacidad debe ser un número positivo, finito y menor o igual a ${MAX_CAPACITY_M2} m²`,
        ),
      );
    }

    const initialComponents: ComponenteDecorativo[] = [
      ...(props.modulos ?? []).map((modulo) => new ElementoDecorativo(modulo)),
      ...(props.componentes ?? []),
    ];

    for (const componente of initialComponents) {
      const treeValidation = validarRaiz(componente);
      if (!treeValidation.ok) {
        return err(treeValidation.error);
      }
    }

    const initialUsed = initialComponents.reduce((acc, c) => acc + c.calcularAreaM2(), 0);

    if (initialUsed > props.capacidadM2) {
      return err(
        new DomainError(
          "package.capacity_exceeded",
          `La suma de módulos (${initialUsed} m²) excede la capacidad del espacio (${props.capacidadM2} m²)`,
        ),
      );
    }

    return ok(new PaqueteDecoracion(props.tipoEspacio, props.capacidadM2, initialComponents));
  }

  get tipoEspacio(): TipoEspacio {
    return this._tipoEspacio;
  }

  get capacidadM2(): number {
    return this._capacidadM2;
  }

  /** Componentes de la raíz del paquete (hojas sueltas y grupos). */
  get componentes(): readonly ComponenteDecorativo[] {
    return [...this._componentes];
  }

  /** Todos los módulos del paquete, incluidos los que están dentro de grupos. */
  get modulos(): readonly ModuloDecoracion[] {
    return this._componentes.flatMap((c) => c.obtenerModulos());
  }

  get espacioUsadoM2(): number {
    return this._componentes.reduce((total, c) => total + c.calcularAreaM2(), 0);
  }

  get presupuestoTotal(): number {
    return this._componentes.reduce((total, c) => total + c.calcularPrecio(), 0);
  }

  /** Busca un grupo del paquete, en cualquier nivel, por su id. */
  public buscarGrupo(grupoId: string): ModuloCompuesto | null {
    for (const componente of this._componentes) {
      if (componente instanceof ModuloCompuesto) {
        const encontrado = componente.buscarGrupo(grupoId);
        if (encontrado) {
          return encontrado;
        }
      }
    }

    return null;
  }

  public agregarModulo(modulo: ModuloDecoracion): Result<void, DomainError> {
    return this.agregarComponente(new ElementoDecorativo(modulo));
  }

  /**
   * Agrega una hoja o un grupo en la raíz del paquete, o dentro del grupo
   * `grupoPadreId` si se indica. Valida capacidad, niveles y ciclos antes de
   * modificar nada.
   */
  public agregarComponente(
    componente: ComponenteDecorativo,
    grupoPadreId?: string,
  ): Result<void, DomainError> {
    const espacioFinal = this.espacioUsadoM2 + componente.calcularAreaM2();
    if (espacioFinal > this._capacidadM2) {
      return err(
        new DomainError(
          "package.capacity_exceeded",
          `No se agregó "${componente.nombre}": excede la capacidad del espacio (${espacioFinal}/${this._capacidadM2} m²).`,
        ),
      );
    }

    if (grupoPadreId !== undefined) {
      const grupoPadre = this.buscarGrupo(grupoPadreId);
      if (!grupoPadre) {
        return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
      }

      return grupoPadre.agregar(componente);
    }

    if (this._componentes.some((c) => c.contiene(componente))) {
      return err(
        new DomainError(
          "package.component_already_grouped",
          `"${componente.nombre}" ya forma parte del paquete.`,
        ),
      );
    }

    const treeValidation = validarRaiz(componente);
    if (!treeValidation.ok) {
      return err(treeValidation.error);
    }

    this._componentes.push(componente);
    return ok(undefined);
  }

  /** Quita una hoja o un grupo por id, en la raíz o dentro de cualquier grupo. */
  public removerModulo(moduloId: string): Result<void, DomainError> {
    const index = this._componentes.findIndex((c) => c.id === moduloId);
    if (index !== -1) {
      this._componentes.splice(index, 1);
      return ok(undefined);
    }

    const removedFromGroup = this._componentes.some(
      (c) => c instanceof ModuloCompuesto && c.remover(moduloId),
    );
    if (removedFromGroup) {
      return ok(undefined);
    }

    return err(
      new DomainError("package.item_not_found", "No encontramos este elemento en el paquete."),
    );
  }
}

/** Un componente de la raíz no debe tener grupo ni superar los niveles permitidos. */
function validarRaiz(componente: ComponenteDecorativo): Result<void, DomainError> {
  if (componente.padre !== null) {
    return err(
      new DomainError(
        "package.component_already_grouped",
        `"${componente.nombre}" ya pertenece a otro grupo.`,
      ),
    );
  }

  if (componente.profundidad() > MAX_NIVELES_GRUPO) {
    return err(
      new DomainError(
        "package.group_depth_exceeded",
        `Los grupos admiten como máximo ${MAX_NIVELES_GRUPO} niveles.`,
      ),
    );
  }

  return ok(undefined);
}
