import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { ComponenteDecorativo } from "./decorative-component";
import type { ModuloDecoracion } from "./decoration-module";
import type { PaqueteDecoracion } from "./decoration-package";

export interface PaqueteDecoracionBuilder {
  agregarMesa(): this;
  agregarArco(): this;
  agregarPistaBaile(): this;
  /** Agrega el grupo "Zona de bienvenida" (arco floral + mesa redonda). */
  agregarZonaBienvenida(): this;
  agregarModulo(modulo: ModuloDecoracion): Result<this, DomainError>;
  /** Agrega una hoja o un grupo usando el contrato común del Composite. */
  agregarComponente(componente: ComponenteDecorativo): Result<this, DomainError>;
  construir(): PaqueteDecoracion;
}
