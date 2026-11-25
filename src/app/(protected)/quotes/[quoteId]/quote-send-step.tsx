"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { QuoteStatus } from "@/modules/quotes/domain/quote-status";

import { todayInBogota } from "../_lib/quote-format";
import { createHttpQuotesClient, type QuotesClient } from "../_lib/quotes-client";

type QuoteSendStepProps = {
  readonly quoteId: string;
  readonly status: QuoteStatus;
  readonly validUntil: string;
  /** Inyectable para las pruebas. */
  readonly client?: Pick<QuotesClient, "changeStatus">;
  /** Inyectable para las pruebas; por defecto la fecha de hoy en Colombia. */
  readonly today?: string;
};

/**
 * Paso "Compartir" de un borrador (DECOR-49). El enlace público y WhatsApp
 * (DECOR-53/54) solo existen para cotizaciones enviadas o aceptadas, y ninguna
 * pantalla permitía marcarla como enviada: este botón usa la transición
 * borrador → enviada de DECOR-50 (`PATCH /api/quotes/{id}/status`). Al
 * terminar, la página se recarga y aparece la sección de compartir.
 */
export function QuoteSendStep({ quoteId, status, validUntil, client, today }: QuoteSendStepProps) {
  const router = useRouter();
  const quotes = useMemo(() => client ?? createHttpQuotesClient(), [client]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  if (status !== "draft") return null;

  // Una vigencia vencida no se envía: primero se actualiza (QuoteActions).
  const expired = validUntil < (today ?? todayInBogota());

  async function handleSend() {
    if (pending) return;

    setPending(true);
    setError(undefined);
    const result = await quotes.changeStatus(quoteId, "sent");

    if (result.ok) {
      router.refresh();
      return;
    }

    setPending(false);

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setError(result.error.message);
  }

  return (
    <section aria-labelledby="quote-send-title" className="configurator-card quote-send">
      <h2 className="section-title" id="quote-send-title">
        Compartir con tu cliente
      </h2>

      {expired ? (
        <p className="content-hint">
          La vigencia de esta cotización ya pasó. Actualízala con una vigencia nueva y luego márcala como
          enviada para compartirla.
        </p>
      ) : (
        <>
          <p className="content-hint">
            Cuando la cotización esté lista, márcala como enviada. Así podrás crear el enlace para tu cliente y
            mandarlo por WhatsApp. Una cotización enviada ya no vuelve a borrador; para cambiarla se crea una
            versión nueva.
          </p>
          <button
            aria-busy={pending}
            className="auth-submit quote-action"
            disabled={pending}
            onClick={handleSend}
            type="button"
          >
            {pending ? "Marcando…" : "Marcar como enviada"}
          </button>
        </>
      )}

      {error ? (
        <p className="auth-error" role="alert">
          No pudimos marcarla como enviada. {error}
        </p>
      ) : null}
    </section>
  );
}
