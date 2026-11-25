"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { quoteStatusLabel, quoteTitle } from "../../quotes/_lib/quote-format";
import { createHttpQuotesClient, type QuoteListItem, type QuotesClient } from "../../quotes/_lib/quotes-client";
import { formatCop } from "../_lib/format";

type PackageQuotesProps = {
  readonly packageId: string;
  /** Inyectable para las pruebas. */
  readonly client?: Pick<QuotesClient, "listQuotes">;
};

type ListState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly quotes: readonly QuoteListItem[] };

/**
 * Última versión de cada cotización de este evento, de la más nueva a la más
 * antigua. `GET /api/quotes` devuelve todas las versiones ordenadas por fecha
 * de creación descendente, así que la primera de cada número es la vigente.
 */
export function latestQuotesForPackage(quotes: readonly QuoteListItem[], packageId: string): QuoteListItem[] {
  const latest = new Map<number, QuoteListItem>();

  for (const quote of quotes) {
    if (quote.packageId !== packageId) continue;
    const current = latest.get(quote.number);
    if (!current || quote.version > current.version) latest.set(quote.number, quote);
  }

  return [...latest.values()].sort((a, b) => b.number - a.number);
}

const NEXT_ACTION: Readonly<Record<QuoteListItem["status"], string>> = {
  accepted: "Tu cliente la aceptó.",
  draft: "Ábrela para revisarla y márcala como enviada para compartirla.",
  expired: "Venció: ábrela y actualízala con una vigencia nueva.",
  sent: "Lista para compartir por enlace o WhatsApp.",
};

/**
 * Cotizaciones del evento (DECOR-49): sin esta lista no había forma de volver
 * a una cotización después de salir de ella.
 */
export function PackageQuotes({ packageId, client }: PackageQuotesProps) {
  const router = useRouter();
  const quotes = useMemo(() => client ?? createHttpQuotesClient(), [client]);
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    quotes
      .listQuotes(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        if (!result.ok) {
          if (result.error.kind === "unauthorized") {
            router.push("/login");
            return;
          }
          setState({ message: result.error.message, status: "error" });
          return;
        }

        setState({ quotes: latestQuotesForPackage(result.value, packageId), status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ message: "Inténtalo de nuevo.", status: "error" });
      });

    return () => controller.abort();
  }, [attempt, packageId, quotes, router]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  return (
    <section
      aria-busy={state.status === "loading"}
      aria-labelledby="package-quotes-title"
      className="configurator-card package-quotes"
    >
      <h2 className="section-title" id="package-quotes-title">
        Tus cotizaciones
      </h2>

      {state.status === "loading" ? (
        <p className="catalog-state" role="status">
          <span aria-hidden="true" className="spinner" />
          Cargando cotizaciones…
        </p>
      ) : null}

      {state.status === "error" ? (
        <div className="catalog-state catalog-error">
          <p className="auth-error" role="alert">
            No pudimos cargar tus cotizaciones. {state.message}
          </p>
          <button className="secondary-button" onClick={retry} type="button">
            Reintentar
          </button>
        </div>
      ) : null}

      {state.status === "ready" && state.quotes.length === 0 ? (
        <p className="content-empty">Todavía no has creado cotizaciones para este evento.</p>
      ) : null}

      {state.status === "ready" && state.quotes.length > 0 ? (
        <ul className="package-quote-list">
          {state.quotes.map((quote) => (
            <li className="package-quote" key={quote.id}>
              <div className="package-quote-head">
                <Link className="package-quote-link" href={`/quotes/${encodeURIComponent(quote.id)}`}>
                  {quoteTitle(quote.number, quote.version)}
                </Link>
                <span className="quote-status" data-status={quote.status}>
                  {quoteStatusLabel(quote.status)}
                </span>
              </div>
              <p className="package-quote-meta">
                Total {formatCop(quote.totalCop)}. {NEXT_ACTION[quote.status]}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
