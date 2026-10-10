export const SPACE_TYPES = ["casa", "aireLibre", "salonSocial"] as const;

export type TipoEspacio = (typeof SPACE_TYPES)[number];

/** Límite superior de `packages.capacity_m2` (NUMERIC(8,2)). */
export const MAX_CAPACITY_M2 = 999999.99;

export function isTipoEspacio(value: unknown): value is TipoEspacio {
  return typeof value === "string" && (SPACE_TYPES as readonly string[]).includes(value);
}

export function isValidCapacityM2(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_CAPACITY_M2;
}
