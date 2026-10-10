import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { ModuloDecoracion } from "./decoration-module";
import type { PaqueteDecoracion } from "./decoration-package";

export interface PaqueteDecoracionBuilder {
  agregarMesa(): this;
  agregarArco(): this;
  agregarPistaBaile(): this;
  agregarModulo(modulo: ModuloDecoracion): Result<this, DomainError>;
  construir(): PaqueteDecoracion;
}
