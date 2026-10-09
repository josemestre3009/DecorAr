import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { ModuloDecoracion } from "./decoration-module";
import { isTipoEspacio, isValidCapacityM2, type TipoEspacio } from "./space-type";

export interface PaqueteDecoracionProps {
  readonly tipoEspacio: TipoEspacio;
  readonly capacidadM2: number;
  readonly modulos?: readonly ModuloDecoracion[];
}

export class PaqueteDecoracion {
  private readonly _tipoEspacio: TipoEspacio;
  private readonly _capacidadM2: number;
  private readonly _modulos: ModuloDecoracion[];

  private constructor(tipoEspacio: TipoEspacio, capacidadM2: number, modulos: ModuloDecoracion[] = []) {
    this._tipoEspacio = tipoEspacio;
    this._capacidadM2 = capacidadM2;
    this._modulos = modulos;
  }

  public static create(props: PaqueteDecoracionProps): Result<PaqueteDecoracion, DomainError> {
    if (!isTipoEspacio(props.tipoEspacio)) {
      return err(
        new DomainError("package.invalid_space_type", `Tipo de espacio no soportado: ${String(props.tipoEspacio)}`),
      );
    }

    if (!isValidCapacityM2(props.capacidadM2)) {
      return err(
        new DomainError("package.invalid_capacity", "La capacidad debe ser un número positivo y finito"),
      );
    }

    const initialModules = props.modulos ? [...props.modulos] : [];
    const initialUsed = initialModules.reduce((acc, m) => acc + m.ocupaM2, 0);

    if (initialUsed > props.capacidadM2) {
      return err(
        new DomainError(
          "package.capacity_exceeded",
          `La suma de módulos (${initialUsed} m²) excede la capacidad del espacio (${props.capacidadM2} m²)`,
        ),
      );
    }

    return ok(new PaqueteDecoracion(props.tipoEspacio, props.capacidadM2, initialModules));
  }

  get tipoEspacio(): TipoEspacio {
    return this._tipoEspacio;
  }

  get capacidadM2(): number {
    return this._capacidadM2;
  }

  get modulos(): readonly ModuloDecoracion[] {
    return [...this._modulos];
  }

  get espacioUsadoM2(): number {
    return this._modulos.reduce((total, m) => total + m.ocupaM2, 0);
  }

  get presupuestoTotal(): number {
    return this._modulos.reduce((total, m) => total + m.precio, 0);
  }

  public agregarModulo(modulo: ModuloDecoracion): Result<void, DomainError> {
    const espacioFinal = this.espacioUsadoM2 + modulo.ocupaM2;
    if (espacioFinal > this._capacidadM2) {
      return err(
        new DomainError(
          "package.capacity_exceeded",
          `No se agregó "${modulo.nombre}": excede la capacidad del espacio (${espacioFinal}/${this._capacidadM2} m²).`,
        ),
      );
    }

    this._modulos.push(modulo);
    return ok(undefined);
  }

  public removerModulo(moduloId: string): Result<void, DomainError> {
    const index = this._modulos.findIndex((m) => m.id === moduloId);
    if (index === -1) {
      return err(
        new DomainError("package.item_not_found", "No encontramos este elemento en el paquete."),
      );
    }

    this._modulos.splice(index, 1);
    return ok(undefined);
  }
}
