import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { CATALOGO_CANONICO } from "./catalog-fixtures";
import type { ComponenteDecorativo } from "./decorative-component";
import { ElementoDecorativo } from "./decorative-element";
import type { ModuloDecoracion } from "./decoration-module";
import { PaqueteDecoracion } from "./decoration-package";
import type { PaqueteDecoracionBuilder } from "./decoration-package-builder";
import { isTipoEspacio, isValidCapacityM2, MAX_CAPACITY_M2, type TipoEspacio } from "./space-type";
import { crearZonaBienvenida } from "./welcome-zone";

export class PaqueteDecoracionBuilderImpl implements PaqueteDecoracionBuilder {
  private paquete: PaqueteDecoracion;
  private readonly reglas: { capacidadM2: number };
  private zonasCreadas = 0;

  constructor(tipoEspacio: TipoEspacio, capacidadM2: number) {
    if (!isTipoEspacio(tipoEspacio)) {
      throw new DomainError("package.invalid_space_type", `Tipo de espacio no soportado: ${String(tipoEspacio)}`);
    }

    if (!isValidCapacityM2(capacidadM2)) {
      throw new DomainError(
        "package.invalid_capacity",
        `La capacidad debe ser un número positivo, finito y menor o igual a ${MAX_CAPACITY_M2} m²`,
      );
    }

    const packageResult = PaqueteDecoracion.create({ capacidadM2, tipoEspacio });
    if (!packageResult.ok) {
      throw packageResult.error;
    }

    this.paquete = packageResult.value;
    this.reglas = { capacidadM2 };
  }

  /** Valida y agrega cualquier `ComponenteDecorativo`: hoja o grupo usan la misma regla. */
  private _validarYAgregar(componente: ComponenteDecorativo): Result<this, DomainError> {
    const espacioFinal = this.paquete.espacioUsadoM2 + componente.calcularAreaM2();
    if (espacioFinal > this.reglas.capacidadM2) {
      const error = new DomainError(
        "package.capacity_exceeded",
        `No se agregó "${componente.nombre}": excede la capacidad del espacio (${espacioFinal}/${this.reglas.capacidadM2} m²).`,
      );
      return err(error);
    }

    const addResult = this.paquete.agregarComponente(componente);
    if (!addResult.ok) {
      return err(addResult.error);
    }

    return ok(this);
  }

  public agregarMesa(): this {
    this._validarYAgregar(new ElementoDecorativo(CATALOGO_CANONICO.mesaRedonda));
    return this;
  }

  public agregarArco(): this {
    this._validarYAgregar(new ElementoDecorativo(CATALOGO_CANONICO.arcoFloral));
    return this;
  }

  public agregarPistaBaile(): this {
    this._validarYAgregar(new ElementoDecorativo(CATALOGO_CANONICO.pistaBaile));
    return this;
  }

  public agregarZonaBienvenida(): this {
    this.zonasCreadas += 1;
    const zona = crearZonaBienvenida(`zona-bienvenida-${this.zonasCreadas}`);
    if (zona.ok) {
      this._validarYAgregar(zona.value);
    }
    return this;
  }

  public agregarModulo(modulo: ModuloDecoracion): Result<this, DomainError> {
    return this._validarYAgregar(new ElementoDecorativo(modulo));
  }

  public agregarComponente(componente: ComponenteDecorativo): Result<this, DomainError> {
    return this._validarYAgregar(componente);
  }

  public construir(): PaqueteDecoracion {
    const cloneResult = PaqueteDecoracion.create({
      capacidadM2: this.paquete.capacidadM2,
      // Copia profunda: los grupos son mutables y el snapshot no debe compartirlos.
      componentes: this.paquete.componentes.map((componente) => componente.copiar()),
      tipoEspacio: this.paquete.tipoEspacio,
    });

    if (!cloneResult.ok) {
      throw cloneResult.error;
    }

    return cloneResult.value;
  }
}
