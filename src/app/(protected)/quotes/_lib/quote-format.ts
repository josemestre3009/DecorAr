import type { QuoteStatus } from "@/modules/quotes/domain/quote-status";

/** 100 % en puntos básicos; mismo valor que `BASIS_POINTS_100` del dominio. */
const BASIS_POINTS_PER_PERCENT = 100;
const MAX_PERCENT = 100;

const percentFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/** Tasa en puntos básicos como porcentaje legible, p. ej. 1900 → "19 %", 1250 → "12,5 %". */
export function formatRateBp(rateBp: number): string {
  return `${percentFormatter.format(rateBp / BASIS_POINTS_PER_PERCENT)} %`;
}

const STATUS_LABELS: Readonly<Record<QuoteStatus, string>> = {
  accepted: "Aceptada",
  draft: "Borrador",
  expired: "Vencida",
  sent: "Enviada",
};

export function quoteStatusLabel(status: QuoteStatus): string {
  return STATUS_LABELS[status];
}

/** Encabezado de la cotización, p. ej. "Cotización N.º 12 · versión 2". */
export function quoteTitle(number: number, version: number): string {
  return `Cotización N.º ${number} · versión ${version}`;
}

export type PercentParse = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string };

/**
 * Convierte el porcentaje escrito por la persona ("19", "12,5", "12.5") en
 * puntos básicos enteros (1900, 1250). Vacío vale `emptyValue`; con
 * `emptyValue` `null` el campo es obligatorio.
 */
export function parsePercentToBp(raw: string, label: string, emptyValue: number | null): PercentParse {
  const text = raw.trim().replace(",", ".");

  if (text.length === 0) {
    return emptyValue === null ? { error: `${label} es obligatorio.`, ok: false } : { ok: true, value: emptyValue };
  }

  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { error: `${label} debe ser un número entre 0 y 100, con hasta dos decimales.`, ok: false };
  }

  const percent = Number(text);
  if (percent > MAX_PERCENT) {
    return { error: `${label} no puede superar el 100 %.`, ok: false };
  }

  return { ok: true, value: Math.round(percent * BASIS_POINTS_PER_PERCENT) };
}

/** Puntos básicos al texto que muestra un campo de porcentaje (1900 → "19", 1250 → "12,5"). */
export function bpToPercentInput(rateBp: number): string {
  return percentFormatter.format(rateBp / BASIS_POINTS_PER_PERCENT);
}

/** Hoy en Colombia como `YYYY-MM-DD` (mínimo de la vigencia, igual que el servidor). */
export function todayInBogota(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Bogota",
    year: "numeric",
  }).format(now);
}
