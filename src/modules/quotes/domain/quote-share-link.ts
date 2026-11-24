import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { QUOTE_TIME_ZONE } from "./quote";
import type { QuoteStatus } from "./quote-status";

/**
 * Enlace público de una cotización (DECOR-53): reglas puras sobre qué
 * cotización se puede compartir y hasta cuándo. La persistencia vive en
 * `private.quote_share_links`; aquí no hay nada de Supabase ni de HTTP.
 */

/** Solo una cotización enviada o aceptada puede compartirse por enlace. */
const SHAREABLE_STATUSES: readonly QuoteStatus[] = ["sent", "accepted"];

export function canShareQuote(status: QuoteStatus): boolean {
  return SHAREABLE_STATUSES.includes(status);
}

/** Valida el estado de la cotización antes de crear o reutilizar un enlace. */
export function validarCotizacionCompartible(status: QuoteStatus): Result<QuoteStatus, DomainError> {
  if (!canShareQuote(status)) {
    return err(
      new DomainError(
        "quote.share_not_allowed",
        "Solo se puede compartir una cotización enviada o aceptada.",
      ),
    );
  }

  return ok(status);
}

/**
 * Fin del día (`QUOTE_TIME_ZONE`) de `validUntil`, como instante UTC: la
 * medianoche del día siguiente en esa zona. Es el límite máximo de vigencia
 * de un enlace; nunca puede superar la vigencia de la propia cotización.
 */
export function endOfDayInQuoteTimeZone(validUntil: string): Date {
  // `Date.UTC` con el día siguiente y luego restando el offset de la zona
  // evitaría cálculos manuales de offset, pero Intl no expone el offset
  // directamente: en su lugar se construye con un día de más a mediodía UTC
  // (evita cualquier salto de huso) y se usa solo la fecha calendario.
  const [year, month, day] = validUntil.split("-").map(Number);
  const nextDayNoonUtc = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    timeZone: QUOTE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(nextDayNoonUtc);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  // La diferencia entre la hora local resultante (siempre cerca del mediodía)
  // y el mediodía UTC es el offset de la zona en ese instante; restarlo del
  // mediodía original da la medianoche local exacta como instante UTC.
  const localHour = Number(get("hour"));
  const offsetHours = localHour - 12;

  return new Date(Date.UTC(year, month - 1, day + 1, 0 - offsetHours, 0, 0));
}

/**
 * Resuelve la vigencia de un enlace nuevo: la fecha propuesta (si llega) o el
 * fin del día de `validUntil`; nunca más allá de ese límite.
 */
export function resolveShareExpiry(
  validUntil: string,
  now: Date,
): Result<Date, DomainError> {
  const limit = endOfDayInQuoteTimeZone(validUntil);

  if (limit <= now) {
    return err(
      new DomainError("quote.share_expiry_too_far", "La cotización ya venció; no se puede compartir."),
    );
  }

  return ok(limit);
}
