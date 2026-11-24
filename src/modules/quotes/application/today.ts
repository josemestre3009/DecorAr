import type { Clock } from "../../../shared/application/ports";
import { QUOTE_TIME_ZONE } from "../domain/quote";

export { QUOTE_TIME_ZONE };

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
