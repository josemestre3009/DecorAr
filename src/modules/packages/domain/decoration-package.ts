import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { ModuloCompuesto } from "./composite-module";
import {
  MAX_NIVELES_GRUPO,
  type ComponenteDecorativo,
  type ComponenteDecorativoPadre,
} from "./decorative-component";
import { ElementoDecorativo } from "./decorative-element";
import type { ModuloDecoracion } from "./decoration-module";
import { calcularDiagnosticoEspacial, type DiagnosticoEspacial } from "./spatial-diagnostic";
import { isTipoEspacio, isValidCapacityM2, MAX_CAPACITY_M2, type TipoEspacio } from "./space-type";

export interface PaqueteDecoracionProps {
  /** Opcional desde DECOR-44: un evento puede no conocer todavía su espacio. */
  readonly tipoEspacio?: TipoEspacio | null;
  /** Opcional desde DECOR-44: el área disponible puede declararse después. */
  readonly capacidadM2?: number | null;
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
  private readonly _tipoEspacio: TipoEspacio | null;
  private readonly _capacidadM2: number | null;
  private readonly _componentes: ComponenteDecorativo[];

  private constructor(tipoEspacio: TipoEspacio | null, capacidadM2: number | null, componentes: ComponenteDecorativo[] = []) {
    this._tipoEspacio = tipoEspacio;
    this._capacidadM2 = capacidadM2;
    this._componentes = componentes;
  }

  public static create(props: PaqueteDecoracionProps): Result<PaqueteDecoracion, DomainError> {
    const tipoEspacio = props.tipoEspacio ?? null;
    const capacidadM2 = props.capacidadM2 ?? null;

    if (tipoEspacio !== null && !isTipoEspacio(tipoEspacio)) {
      return err(
        new DomainError("package.invalid_space_type", `Tipo de espacio no soportado: ${String(tipoEspacio)}`),
      );
    }

    if (capacidadM2 !== null && !isValidCapacityM2(capacidadM2)) {
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

    return ok(new PaqueteDecoracion(tipoEspacio, capacidadM2, initialComponents));
  }

  get tipoEspacio(): TipoEspacio | null {
    return this._tipoEspacio;
  }

  get capacidadM2(): number | null {
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

  /**
   * Diagnóstico espacial derivado (DECOR-44). El exceso no bloquea: solo se
   * informa con área disponible y requerida.
   */
  get diagnosticoEspacial(): DiagnosticoEspacial {
    return calcularDiagnosticoEspacial(this._capacidadM2, this.espacioUsadoM2);
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

  /** Busca cualquier componente (hoja o grupo) en la raíz o en un subgrupo. */
  public buscarComponente(componenteId: string): ComponenteDecorativo | null {
    return buscarEnLista(this._componentes, componenteId);
  }

  /** Renombra un grupo del paquete validando el nombre antes de tocarlo. */
  public renombrarGrupo(grupoId: string, nombre: string): Result<void, DomainError> {
    const grupo = this.buscarGrupo(grupoId);
    if (!grupo) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    return grupo.renombrar(nombre);
  }

  /**
   * Mueve un grupo a la raíz o dentro de otro grupo del mismo paquete,
   * conservando ids y contenido. Rechaza ciclos y una profundidad total mayor
   * a tres niveles sin modificar el árbol.
   */
  public moverGrupo(grupoId: string, destinoGrupoId: string | null): Result<void, DomainError> {
    const grupo = this.buscarGrupo(grupoId);
    if (!grupo) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    return this._moverComponente(grupo, destinoGrupoId);
  }

  /** Mueve una hoja existente a la raíz o a un grupo, conservando su instancia. */
  public moverComponente(
    componenteId: string,
    destinoGrupoId: string | null,
  ): Result<void, DomainError> {
    const componente = this.buscarComponente(componenteId);
    if (!componente) {
      return err(
        new DomainError("package.item_not_found", "No encontramos este elemento en el paquete."),
      );
    }

    return this._moverComponente(componente, destinoGrupoId);
  }

  /**
   * Reubicación segura de una hoja o grupo: valida destino, ciclo y
   * profundidad total antes de desvincular, y restaura el árbol en memoria si
   * el destino rechazara el componente.
   */
  private _moverComponente(
    componente: ComponenteDecorativo,
    destinoGrupoId: string | null,
  ): Result<void, DomainError> {
    const nuevoPadre = destinoGrupoId === null ? null : this.buscarGrupo(destinoGrupoId);
    if (destinoGrupoId !== null && !nuevoPadre) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    if (componente.padre === nuevoPadre) {
      return ok(undefined);
    }

    if (nuevoPadre) {
      if (componente.contiene(nuevoPadre)) {
        return err(
          new DomainError(
            "package.group_cycle",
            `No se puede mover "${componente.nombre}" dentro de un descendiente propio.`,
          ),
        );
      }

      if (nuevoPadre.nivel() + componente.profundidad() > MAX_NIVELES_GRUPO) {
        return err(
          new DomainError(
            "package.group_depth_exceeded",
            `Los grupos admiten como máximo ${MAX_NIVELES_GRUPO} niveles.`,
          ),
        );
      }
    }

    const padreAnterior = componente.padre;
    this._desvincular(componente);

    const reincorporado =
      nuevoPadre === null ? this._agregarEnRaiz(componente) : nuevoPadre.agregar(componente);
    if (!reincorporado.ok) {
      this._reincorporar(componente, padreAnterior);
      return err(reincorporado.error);
    }

    return ok(undefined);
  }

  private _desvincular(componente: ComponenteDecorativo): void {
    const padre = componente.padre;
    if (padre === null) {
      const indice = this._componentes.indexOf(componente);
      if (indice !== -1) {
        this._componentes.splice(indice, 1);
      }
      return;
    }

    if (padre instanceof ModuloCompuesto) {
      padre.remover(componente.id);
    }
  }

  private _agregarEnRaiz(componente: ComponenteDecorativo): Result<void, DomainError> {
    const treeValidation = validarRaiz(componente);
    if (!treeValidation.ok) {
      return err(treeValidation.error);
    }

    this._componentes.push(componente);
    return ok(undefined);
  }

  private _reincorporar(
    componente: ComponenteDecorativo,
    padreAnterior: ComponenteDecorativoPadre | null,
  ): void {
    if (padreAnterior === null) {
      this._componentes.push(componente);
      return;
    }

    if (padreAnterior instanceof ModuloCompuesto) {
      padreAnterior.agregar(componente);
    }
  }

  public agregarModulo(modulo: ModuloDecoracion): Result<void, DomainError> {
    return this.agregarComponente(new ElementoDecorativo(modulo));
  }

  /**
   * Agrega una hoja o un grupo en la raíz del paquete, o dentro del grupo
   * `grupoPadreId` si se indica. Valida niveles y ciclos antes de modificar
   * nada. El exceso de área ya no rechaza (DECOR-44): solo lo informa el
   * diagnóstico espacial.
   */
  public agregarComponente(
    componente: ComponenteDecorativo,
    grupoPadreId?: string,
  ): Result<void, DomainError> {
    // Un componente que ya está en el paquete (raíz o grupo) no se agrega dos veces.
    if (this._componentes.some((c) => c.contiene(componente))) {
      return err(
        new DomainError(
          "package.component_already_grouped",
          `"${componente.nombre}" ya forma parte del paquete.`,
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

/** Busca por id un componente de una lista, descendiendo en los subgrupos. */
function buscarEnLista(
  componentes: readonly ComponenteDecorativo[],
  componenteId: string,
): ComponenteDecorativo | null {
  for (const componente of componentes) {
    if (componente.id === componenteId) {
      return componente;
    }

    if (componente instanceof ModuloCompuesto) {
      const encontrado = buscarEnLista(componente.hijos, componenteId);
      if (encontrado) {
        return encontrado;
      }
    }
  }

  return null;
}
