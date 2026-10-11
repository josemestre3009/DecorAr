import type { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { CATALOGO_CANONICO } from "./catalog-fixtures";
import { ModuloCompuesto } from "./composite-module";
import { ElementoDecorativo } from "./decorative-element";
import type { ModuloDecoracion } from "./decoration-module";

export const NOMBRE_ZONA_BIENVENIDA = "Zona de bienvenida";

/**
 * Demo mínima del Composite (docs/DecorAR.md §1.4): "Zona de bienvenida" =
 * arco floral + mesa redonda, módulos que ya existen en el catálogo. Por
 * defecto usa el catálogo canónico del Builder; el caso de uso le pasa los
 * módulos reales del catálogo.
 */
export function crearZonaBienvenida(
  grupoId: string,
  arco: ModuloDecoracion = CATALOGO_CANONICO.arcoFloral,
  mesa: ModuloDecoracion = CATALOGO_CANONICO.mesaRedonda,
): Result<ModuloCompuesto, DomainError> {
  const grupo = ModuloCompuesto.crear(grupoId, NOMBRE_ZONA_BIENVENIDA);
  if (!grupo.ok) {
    return grupo;
  }

  for (const modulo of [arco, mesa]) {
    const agregado = grupo.value.agregar(new ElementoDecorativo(modulo));
    if (!agregado.ok) {
      return err(agregado.error);
    }
  }

  return ok(grupo.value);
}
