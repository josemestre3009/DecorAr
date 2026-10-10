import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

import {
  claveActivo3D,
  crearActivo3DCompartido,
  mismosDatosActivo3D,
  type Activo3DCompartido,
  type DatosActivo3D,
} from "./activo-3d-compartido";

/**
 * Fábrica del Flyweight. Entrega siempre el mismo `Activo3DCompartido` para un
 * `assetId` + `version`, de modo que N instancias de una mesa comparten una sola
 * referencia (y una sola URL que descargar) en lugar de N copias.
 *
 * Las versiones publicadas son inmutables (DECOR-36): si llegan datos distintos
 * con la misma clave, es un error de datos y no se sobrescribe el activo.
 */
export class FabricaActivos3D {
  private readonly activos = new Map<string, Activo3DCompartido>();
  private creados = 0;

  obtener(datos: DatosActivo3D): Result<Activo3DCompartido, DomainError> {
    const clave = claveActivo3D(datos.assetId.trim(), datos.version);
    const existente = this.activos.get(clave);

    if (existente) {
      if (!mismosDatosActivo3D(existente, datos)) {
        return err(
          new DomainError(
            "ar.asset_conflict",
            `El activo ${clave} llegó con datos distintos a los ya cargados.`,
          ),
        );
      }

      return ok(existente);
    }

    const creado = crearActivo3DCompartido(datos);

    if (!creado.ok) {
      return creado;
    }

    this.activos.set(clave, creado.value);
    this.creados += 1;

    return ok(creado.value);
  }

  /** Cuántos activos distintos se crearon (evidencia del patrón en pruebas y UI). */
  get activosCreados(): number {
    return this.creados;
  }

  get tamano(): number {
    return this.activos.size;
  }
}
