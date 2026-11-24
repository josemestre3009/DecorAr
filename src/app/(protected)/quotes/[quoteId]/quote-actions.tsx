"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import type { QuoteDto } from "@/modules/quotes/application/dtos/quote.dto";

import { todayInBogota } from "../_lib/quote-format";
import { createHttpQuotesClient, type QuotesClient } from "../_lib/quotes-client";

type QuoteActionsProps = {
  readonly quote: QuoteDto;
  /** Inyectable para las pruebas. */
  readonly client?: QuotesClient;
  /** Inyectable para las pruebas; por defecto la fecha de hoy en Colombia. */
  readonly today?: string;
};

/**
 * Acciones de la vista previa (DECOR-51): volver a editar el evento, crear una
 * versión nueva con los cambios del evento (mismos términos), descargar el
 * PDF de esta versión (DECOR-52) e imprimir.
 * Ninguna versión anterior se modifica: "Actualizar" crea otra (DECOR-50).
 */
export function QuoteActions({ quote, client, today }: QuoteActionsProps) {
  const router = useRouter();
  const quotes = useMemo(() => client ?? createHttpQuotesClient(), [client]);
  const minDate = today ?? todayInBogota();
  const expired = quote.validUntil < minDate;
  const [validUntil, setValidUntil] = useState(expired ? "" : quote.validUntil);
  const [pending, setPending] = useState(false);
  const [validUntilError, setValidUntilError] = useState<string>();
  const [error, setError] = useState<string>();

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !quote.packageId) return;

    if (!validUntil || validUntil < minDate) {
      setValidUntilError("Elige una vigencia desde hoy en adelante.");
      return;
    }

    setValidUntilError(undefined);
    setError(undefined);
    setPending(true);

    const result = await quotes.createQuoteVersion(quote.id, {
      clientName: quote.client.name,
      conditions: quote.conditions,
      depositRateBp: quote.terms.depositRateBp,
      discountRateBp: quote.terms.discountRateBp,
      taxRateBp: quote.terms.taxRateBp,
      validUntil,
    });

    if (result.ok) {
      router.push(`/quotes/${encodeURIComponent(result.value.id)}`);
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
    <section aria-labelledby="quote-actions-title" className="configurator-card quote-actions">
      <h2 className="section-title" id="quote-actions-title">
        Antes de generar el PDF
      </h2>

      {quote.packageId ? (
        <>
          <p className="content-hint">
            ¿Falta algo? Edita el evento y luego actualiza la cotización: se crea una versión nueva con los
            precios actuales y esta versión se conserva.
          </p>
          <form aria-label="Actualizar cotización" className="quote-actions-form" noValidate onSubmit={handleUpdate}>
            <Link className="secondary-link quote-action" href={`/packages/${encodeURIComponent(quote.packageId)}`}>
              Volver a editar el evento
            </Link>
            {expired ? (
              <div className="auth-field">
                <label className="auth-label" htmlFor="quote-new-valid-until">
                  Nueva vigencia (la actual ya pasó)
                </label>
                <input
                  aria-describedby={validUntilError ? "quote-valid-until-error" : undefined}
                  aria-invalid={validUntilError ? true : undefined}
                  className="auth-input"
                  id="quote-new-valid-until"
                  min={minDate}
                  onChange={(change) => setValidUntil(change.target.value)}
                  required
                  type="date"
                  value={validUntil}
                />
                {validUntilError ? (
                  <p className="auth-error" id="quote-valid-until-error" role="alert">
                    {validUntilError}
                  </p>
                ) : null}
              </div>
            ) : null}
            <button aria-busy={pending} className="auth-submit quote-action" disabled={pending} type="submit">
              {pending ? "Actualizando…" : "Actualizar cotización"}
            </button>
          </form>
        </>
      ) : (
        <p className="content-hint">
          El evento de esta cotización ya no existe, así que no se puede editar ni actualizar. Esta versión se
          conserva tal como se guardó.
        </p>
      )}

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <a
        className="auth-submit quote-action"
        download
        href={`/api/quotes/${encodeURIComponent(quote.id)}/pdf`}
      >
        Descargar PDF
      </a>

      <button className="secondary-button quote-action" onClick={() => window.print()} type="button">
        Imprimir
      </button>
    </section>
  );
}
