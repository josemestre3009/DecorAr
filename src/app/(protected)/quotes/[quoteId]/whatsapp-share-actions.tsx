"use client";

import { useSyncExternalStore } from "react";

import { buildWhatsAppUrl } from "../_lib/quote-share-message";

type WhatsAppShareActionsProps = {
  /** Mensaje ya armado, con el enlace público incluido. */
  readonly message: string;
  readonly disabled?: boolean;
  /** Muestra (o limpia, con `undefined`) el aviso en la sección contenedora. */
  readonly onError: (message: string | undefined) => void;
};

export const SHARE_ERROR = "No pudimos abrir el menú de compartir. Usa «Enviar por WhatsApp» o copia el enlace.";

function subscribe(): () => void {
  return () => {};
}

function hasWebShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

function isAbort(cause: unknown): boolean {
  // DOMException no siempre hereda de Error fuera del navegador: se mira el nombre.
  return typeof cause === "object" && cause !== null && "name" in cause && cause.name === "AbortError";
}

/**
 * Compartir la cotización (DECOR-54). «Compartir» abre el menú nativo del
 * dispositivo (Web Share API) solo si el navegador lo ofrece; «Enviar por
 * WhatsApp» abre wa.me con el mensaje. Se comparte solo texto: nunca se
 * adjunta un archivo. «Copiar enlace» (DECOR-53) queda como respaldo.
 */
export function WhatsAppShareActions({ message, disabled = false, onError }: WhatsAppShareActionsProps) {
  // En el servidor no hay `navigator`: el botón aparece tras hidratar, sin
  // desajuste entre el HTML del servidor y el del navegador.
  const canShare = useSyncExternalStore(subscribe, hasWebShare, () => false);

  async function handleShare() {
    onError(undefined);
    try {
      // Llamada directa desde el clic (activación del usuario). Solo `text`:
      // incluye el enlace una vez; con `url` WhatsApp lo repetiría.
      await navigator.share({ text: message });
    } catch (cause) {
      // Cancelar el menú no es un error.
      if (!isAbort(cause)) onError(SHARE_ERROR);
    }
  }

  return (
    <>
      {canShare ? (
        <button className="secondary-button quote-action" disabled={disabled} onClick={handleShare} type="button">
          Compartir
        </button>
      ) : null}
      <a
        aria-disabled={disabled || undefined}
        className="secondary-link quote-action"
        href={buildWhatsAppUrl(message)}
        onClick={disabled ? (event) => event.preventDefault() : undefined}
        rel="noopener noreferrer"
        target="_blank"
      >
        Enviar por WhatsApp
      </a>
    </>
  );
}
