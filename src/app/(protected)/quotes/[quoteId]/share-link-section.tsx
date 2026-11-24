"use client";

import { useEffect, useState } from "react";

import { canShareQuote } from "@/modules/quotes/domain/quote-share-link";
import type { QuoteStatus } from "@/modules/quotes/domain/quote-status";

import { createHttpQuotesClient, type QuotesClient, type QuoteShareLink } from "../_lib/quotes-client";

type ShareLinkSectionProps = {
  readonly quoteId: string;
  readonly status: QuoteStatus;
  /** Inyectable para las pruebas. */
  readonly client?: Pick<QuotesClient, "getShareLink" | "createShareLink" | "revokeShareLink">;
};

/**
 * Enlace público del cliente (DECOR-53): crear/copiar/revocar. Solo visible
 * con una cotización enviada o aceptada; el servidor vuelve a validarlo.
 */
export function ShareLinkSection({ quoteId, status, client }: ShareLinkSectionProps) {
  const quotes = client ?? createHttpQuotesClient();
  const [link, setLink] = useState<QuoteShareLink | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!canShareQuote(status)) return;

    let active = true;
    quotes.getShareLink(quoteId).then((result) => {
      if (!active) return;
      if (result.ok) setLink(result.value);
      setLoaded(true);
    });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId, status]);

  if (!canShareQuote(status)) return null;

  async function handleCreate() {
    setPending(true);
    setError(undefined);
    setCopied(false);

    const result = await quotes.createShareLink(quoteId);

    setPending(false);
    if (result.ok) {
      setLink(result.value);
      return;
    }

    setError(result.error.message);
  }

  async function handleCopy() {
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError("No pudimos copiar el enlace. Cópialo manualmente.");
    }
  }

  async function handleRevoke() {
    setPending(true);
    setError(undefined);

    const result = await quotes.revokeShareLink(quoteId);

    setPending(false);
    if (result.ok) {
      setLink(null);
      setCopied(false);
      return;
    }

    setError(result.error.message);
  }

  return (
    <section aria-labelledby="quote-share-title" className="configurator-card quote-share-link">
      <h2 className="section-title" id="quote-share-title">
        Enlace para el cliente
      </h2>
      <p className="content-hint">Quien tenga este enlace puede ver la cotización sin iniciar sesión.</p>

      {!loaded ? null : link ? (
        <div className="quote-share-active">
          <input aria-label="Enlace público" className="auth-input" readOnly type="text" value={link.url} />
          <div className="quote-actions-form">
            <button
              aria-busy={pending}
              className="secondary-button quote-action"
              disabled={pending}
              onClick={handleCopy}
              type="button"
            >
              {copied ? "Copiado" : "Copiar enlace"}
            </button>
            <button
              aria-busy={pending}
              className="secondary-button quote-action"
              disabled={pending}
              onClick={handleRevoke}
              type="button"
            >
              {pending ? "Revocando…" : "Revocar enlace"}
            </button>
          </div>
        </div>
      ) : (
        <button
          aria-busy={pending}
          className="auth-submit quote-action"
          disabled={pending}
          onClick={handleCreate}
          type="button"
        >
          {pending ? "Creando…" : "Crear enlace"}
        </button>
      )}

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
