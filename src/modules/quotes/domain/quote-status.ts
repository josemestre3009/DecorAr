import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

/** Estados de una versión de cotización (DECOR-50). */
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Toda versión nueva nace como borrador. */
export const INITIAL_QUOTE_STATUS: QuoteStatus = "draft";

/**
 * Transiciones permitidas. `accepted` y `expired` son finales: una cotización
 * aceptada o vencida no vuelve atrás; para cambiar algo se crea otra versión.
 * La misma tabla se repite en el disparador de `public.quotes`.
 */
const TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  accepted: [],
  draft: ["sent", "expired"],
  expired: [],
  sent: ["accepted", "expired"],
};

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === "string" && (QUOTE_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Valida el estado destino y la transición desde el estado actual. */
export function validarTransicionEstado(
  from: QuoteStatus,
  to: unknown,
): Result<QuoteStatus, DomainError> {
  if (!isQuoteStatus(to)) {
    return err(
      new DomainError(
        "quote.invalid_status",
        `El estado debe ser uno de: ${QUOTE_STATUSES.join(", ")}.`,
      ),
    );
  }

  if (!canTransition(from, to)) {
    return err(
      new DomainError(
        "quote.invalid_status_transition",
        `No se puede pasar una cotización de "${from}" a "${to}".`,
      ),
    );
  }

  return ok(to);
}
