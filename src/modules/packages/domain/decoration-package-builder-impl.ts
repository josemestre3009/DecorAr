import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { CATALOGO_CANONICO } from "./catalog-fixtures";
import type { ModuloDecoracion } from "./decoration-module";
import { PaqueteDecoracion } from "./decoration-package";
import type { PaqueteDecoracionBuilder } from "./decoration-package-builder";
import { isTipoEspacio, isValidCapacityM2, type TipoEspacio } from "./space-type";

export class PaqueteDecoracionBuilderImpl implements PaqueteDecoracionBuilder {
  private paquete: PaqueteDecoracion;
  private readonly reglas: { capacidadM2: number };

  constructor(tipoEspacio: TipoEspacio, capacidadM2: number) {
    if (!isTipoEspacio(tipoEspacio)) {
      throw new DomainError("package.invalid_space_type", `Tipo de espacio no soportado: ${String(tipoEspacio)}`);
    }

    if (!isValidCapacityM2(capacidadM2)) {
      throw new DomainError("package.invalid_capacity", "La capacidad debe ser un número positivo y finito");
    }

    const packageResult = PaqueteDecoracion.create({ capacidadM2, tipoEspacio });
    if (!packageResult.ok) {
      throw packageResult.error;
    }

    this.paquete = packageResult.value;
    this.reglas = { capacidadM2 };
  }

  private _validarYAgregar(modulo: ModuloDecoracion): Result<this, DomainError> {
    const espacioFinal = this.paquete.espacioUsadoM2 + modulo.ocupaM2;
    if (espacioFinal > this.reglas.capacidadM2) {
      const error = new DomainError(
        "package.capacity_exceeded",
        `No se agregó "${modulo.nombre}": excede la capacidad del espacio (${espacioFinal}/${this.reglas.capacidadM2} m²).`,
      );
      return err(error);
    }

    const addResult = this.paquete.agregarModulo(modulo);
    if (!addResult.ok) {
      return err(addResult.error);
    }

    return ok(this);
  }

  public agregarMesa(): this {
    this._validarYAgregar(CATALOGO_CANONICO.mesaRedonda);
    return this;
  }

  public agregarArco(): this {
    this._validarYAgregar(CATALOGO_CANONICO.arcoFloral);
    return this;
  }

  public agregarPistaBaile(): this {
    this._validarYAgregar(CATALOGO_CANONICO.pistaBaile);
    return this;
  }

  public agregarModulo(modulo: ModuloDecoracion): Result<this, DomainError> {
    return this._validarYAgregar(modulo);
  }

  public construir(): PaqueteDecoracion {
    const cloneResult = PaqueteDecoracion.create({
      capacidadM2: this.paquete.capacidadM2,
      modulos: this.paquete.modulos,
      tipoEspacio: this.paquete.tipoEspacio,
    });

    if (!cloneResult.ok) {
      throw cloneResult.error;
    }

    return cloneResult.value;
  }
}
