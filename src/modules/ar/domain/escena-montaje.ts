import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

import type { Posicion3D } from "./instancia-decorativa";

/** Límites de la escena: metros para x/y/z, grados para la rotación (DECOR-46). */
const LIMITE_X = 50;
const LIMITE_Z = 50;
const LIMITE_Y_MIN = -1;
const LIMITE_Y_MAX = 5;
const MAX_ITEMS = 100;

export interface TransformacionItem {
  readonly itemId: string;
  readonly posicion: Posicion3D;
  /** Giro sobre el eje vertical, normalizado a [0, 360). */
  readonly rotacionDeg: number;
}

/**
 * Posición y rotación horizontal de cada unidad de un paquete (DECOR-46).
 * Relativa a un origen que el propio montaje define, no a la sesión WebXR.
 * No conoce escala, inclinación ni color: son explícitamente fuera de
 * alcance (ver `openspec/changes/decor-46-scene-transforms/design.md`).
 */
export class EscenaMontaje {
  private constructor(readonly transformaciones: readonly TransformacionItem[]) {}

  static crear(items: readonly TransformacionItem[]): Result<EscenaMontaje, DomainError> {
    if (items.length > MAX_ITEMS) {
      return err(new DomainError("ar.scene_too_many_items", `La escena admite como máximo ${MAX_ITEMS} unidades.`));
    }

    const vistos = new Set<string>();

    for (const item of items) {
      if (!item.itemId || item.itemId.trim().length === 0) {
        return err(new DomainError("ar.scene_invalid_item", "El identificador de la unidad no es válido."));
      }

      if (vistos.has(item.itemId)) {
        return err(new DomainError("ar.scene_duplicate_item", "Cada unidad solo puede aparecer una vez en la escena."));
      }
      vistos.add(item.itemId);

      const { x, y, z } = item.posicion;
      if (![x, y, z].every(Number.isFinite)) {
        return err(new DomainError("ar.invalid_position", "La posición debe tener números finitos."));
      }

      if (x < -LIMITE_X || x > LIMITE_X || z < -LIMITE_Z || z > LIMITE_Z) {
        return err(new DomainError("ar.scene_position_out_of_bounds", "La posición horizontal supera el límite permitido."));
      }

      if (y < LIMITE_Y_MIN || y > LIMITE_Y_MAX) {
        return err(new DomainError("ar.scene_position_out_of_bounds", "La altura supera el límite permitido."));
      }

      if (!Number.isFinite(item.rotacionDeg)) {
        return err(new DomainError("ar.invalid_rotation", "La rotación debe ser un número finito."));
      }
    }

    return ok(
      new EscenaMontaje(
        items.map((item) => Object.freeze({ ...item, rotacionDeg: normalizarGrados(item.rotacionDeg) })),
      ),
    );
  }
}

function normalizarGrados(grados: number): number {
  const resto = grados % 360;
  const normalizado = resto < 0 ? resto + 360 : resto;

  // Evita -0, que no es igual a 0 con Object.is ni en las pruebas.
  return normalizado === 0 ? 0 : normalizado;
}
