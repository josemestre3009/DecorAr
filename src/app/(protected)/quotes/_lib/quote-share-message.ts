import { formatCop, formatEventDate } from "../../packages/_lib/format";
import { quoteTitle } from "./quote-format";

/** Datos de la cotización que lleva el mensaje para el cliente (DECOR-54). */
export type QuoteShareSummary = {
  readonly clientName: string | null;
  readonly number: number;
  readonly version: number;
  readonly totalCop: number;
  readonly validUntil: string | null;
};

/**
 * Mensaje listo para WhatsApp o el menú de compartir: saludo, cotización,
 * total, vigencia y el enlace público. Un dato que falta (cliente sin nombre,
 * vigencia o total no interpretables) se omite en lugar de mostrarse vacío; el
 * enlace siempre va, una sola vez y sin modificar.
 */
export function buildQuoteShareMessage(summary: QuoteShareSummary, publicUrl: string): string {
  const clientName = summary.clientName?.trim();
  const greeting = clientName ? `Hola, ${clientName}.` : "Hola.";
  const lines = [`${greeting} Te comparto la ${quoteTitle(summary.number, summary.version)}.`];

  if (Number.isFinite(summary.totalCop)) {
    lines.push(`Total: ${formatCop(summary.totalCop)}`);
  }

  const validUntil = formatEventDate(summary.validUntil);
  if (validUntil) {
    lines.push(`Válida hasta: ${validUntil}`);
  }

  lines.push(`Puedes verla aquí: ${publicUrl}`);

  return lines.join("\n");
}

/**
 * Enlace de WhatsApp (click-to-chat) con el mensaje ya escrito. Sin número:
 * el sistema no guarda el teléfono del cliente, así que WhatsApp abre la lista
 * de contactos. Si WhatsApp no está instalado, wa.me ofrece WhatsApp Web o la
 * descarga.
 */
export function buildWhatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
