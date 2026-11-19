import type { Clock } from "../../../shared/application/ports";

/** Zona horaria comercial de DecorAR: la vigencia se compara con la fecha local. */
export const QUOTE_TIME_ZONE = "America/Bogota";

/**
 * Fecha de hoy (`YYYY-MM-DD`) en Colombia. Con UTC, desde las 7 p. m. ya sería
 * "mañana" y una vigencia de hoy se rechazaría por error.
 */
export function todayIso(clock: Clock): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: QUOTE_TIME_ZONE,
    year: "numeric",
  }).format(clock.now());
}
