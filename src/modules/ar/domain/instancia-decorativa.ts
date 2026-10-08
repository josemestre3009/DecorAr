import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

import type { Activo3DCompartido } from "./activo-3d-compartido";

export interface Posicion3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EstadoInstancia {
  readonly posicion: Posicion3D;
  /** Giro sobre el eje vertical, normalizado a [0, 360). */
  readonly rotacionGrados: number;
  /** Color permitido en formato `#rrggbb`, o `null` para el color original. */
  readonly color: string | null;
}

const ORIGEN: Posicion3D = Object.freeze({ x: 0, y: 0, z: 0 });
const COLOR_HEX = /^#[0-9a-f]{6}$/i;

/**
 * Estado extrínseco del Flyweight: lo que cambia de una copia a otra (posición,
 * rotación y color). Apunta al activo compartido sin copiarlo. La escala no es
 * configurable: AR coloca el modelo a 1:1 (`ar-scale="fixed"`).
 *
 * Cada cambio devuelve una instancia nueva; el activo sigue siendo el mismo.
 */
export class InstanciaDecorativa {
  readonly escala = 1;

  private constructor(
    readonly activo: Activo3DCompartido,
    private readonly estado: EstadoInstancia,
  ) {}

  static crear(
    activo: Activo3DCompartido,
    estado: Partial<EstadoInstancia> = {},
  ): Result<InstanciaDecorativa, DomainError> {
    const posicion = estado.posicion ?? ORIGEN;

    if (![posicion.x, posicion.y, posicion.z].every(Number.isFinite)) {
      return err(new DomainError("ar.invalid_position", "La posición debe tener números finitos."));
    }

    const rotacion = estado.rotacionGrados ?? 0;

    if (!Number.isFinite(rotacion)) {
      return err(new DomainError("ar.invalid_rotation", "La rotación debe ser un número finito."));
    }

    const color = estado.color ?? null;

    if (color !== null && !COLOR_HEX.test(color)) {
      return err(new DomainError("ar.invalid_color", "El color debe tener el formato #rrggbb."));
    }

    return ok(
      new InstanciaDecorativa(
        activo,
        Object.freeze({
          color: color === null ? null : color.toLowerCase(),
          posicion: Object.freeze({ x: posicion.x, y: posicion.y, z: posicion.z }),
          rotacionGrados: normalizarGrados(rotacion),
        }),
      ),
    );
  }

  get posicion(): Posicion3D {
    return this.estado.posicion;
  }

  get rotacionGrados(): number {
    return this.estado.rotacionGrados;
  }

  get color(): string | null {
    return this.estado.color;
  }

  mover(posicion: Posicion3D): Result<InstanciaDecorativa, DomainError> {
    return InstanciaDecorativa.crear(this.activo, { ...this.estado, posicion });
  }

  rotar(grados: number): Result<InstanciaDecorativa, DomainError> {
    return InstanciaDecorativa.crear(this.activo, {
      ...this.estado,
      rotacionGrados: this.estado.rotacionGrados + grados,
    });
  }

  colorear(color: string | null): Result<InstanciaDecorativa, DomainError> {
    return InstanciaDecorativa.crear(this.activo, { ...this.estado, color });
  }
}

function normalizarGrados(grados: number): number {
  const resto = grados % 360;
  const normalizado = resto < 0 ? resto + 360 : resto;

  // Evita -0, que no es igual a 0 con Object.is ni en las pruebas.
  return normalizado === 0 ? 0 : normalizado;
}
