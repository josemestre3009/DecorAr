import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { QuoteDto } from "@/modules/quotes/application/dtos/quote.dto";
import { createQuoteQueryDependencies } from "@/composition/server";
import { requireSessionUser } from "@/composition/session-guard";

import { Icon } from "../../_ui/icon";
import { EventNav } from "../../packages/[packageId]/event-nav";
import { eventSectionHref } from "../../packages/_lib/event-sections";
import { resolvePackagesMode } from "../../packages/_lib/packages-client";
import { PageHeading } from "../../packages/[packageId]/page-heading";
import { RefreshButton } from "../../packages/[packageId]/refresh-button";
import { quoteTitle } from "../_lib/quote-format";
import { QuoteActions } from "./quote-actions";
import { QuotePreview } from "./quote-preview";
import { QuoteSendStep } from "./quote-send-step";
import { ShareLinkSection } from "./share-link-section";

export const metadata: Metadata = {
  title: "Cotización · DecorAR",
};

type QuotePageProps = {
  readonly params: Promise<{ readonly quoteId: string }>;
};

type QuotePreviewState =
  | { readonly status: "ready"; readonly quote: QuoteDto }
  | { readonly status: "error" };

/**
 * Vista previa (DECOR-51): lee la versión guardada en el servidor bajo la RLS
 * del dueño. Una cotización ajena, inexistente o con id inválido responde 404
 * sin revelar que existe; sin sesión se vuelve a /login.
 */
export async function loadQuotePreview(quoteId: string): Promise<QuotePreviewState> {
  const { getQuote } = await createQuoteQueryDependencies();

  const result = await getQuote.execute(quoteId);
  if (!result.ok) {
    if (result.error.code === "quote.not_found") notFound();
    if (result.error.code === "auth.unauthenticated") redirect("/login");
    console.error(`[QuotePage] No se pudo leer la cotización (${randomUUID()}):`, result.error.code);
    return { status: "error" };
  }

  return { quote: result.value, status: "ready" };
}

export default async function QuotePage({ params }: QuotePageProps) {
  // Verificación efectiva por página: el layout no corre en la navegación del
  // cliente (ver src/composition/session-guard.ts).
  await requireSessionUser();

  const { quoteId } = await params;
  // Las cotizaciones solo existen con la API real; en modo simulado (DECOR-20)
  // no hay nada que leer.
  const isLive = resolvePackagesMode(process.env.NEXT_PUBLIC_DECOR_PACKAGES_API) === "live";
  const state = isLive ? await loadQuotePreview(quoteId) : null;
  const quote = state?.status === "ready" ? state.quote : null;

  const packageId = quote?.packageId ?? null;
  const shareable = quote?.status === "sent" || quote?.status === "accepted";

  const content = (
    <main className={packageId ? "catalog-page quote-page event-main" : "catalog-page quote-page"}>
      <header className="event-header">
        <div className="catalog-nav quote-nav">
          <Link className="back-link" href={packageId ? eventSectionHref(packageId, "cotizar") : "/packages"}>
            <Icon name="back" size={18} />
            {packageId ? "Cotizaciones" : "Eventos"}
          </Link>
        </div>
        <p className="event-kicker">{quote ? (shareable ? "Lista para compartir" : "Revisa antes de enviar") : "Cotización"}</p>
        <PageHeading>{quote ? quoteTitle(quote.number, quote.version) : "Cotización"}</PageHeading>
        <p className="page-lead">
          Revisa los datos, los conceptos y los totales antes de generar o compartir el PDF.
        </p>
      </header>

      {state === null ? (
        <p className="simulation-note">Las cotizaciones se muestran con la API real (modo live).</p>
      ) : null}

      {state?.status === "error" ? (
        <section className="configurator-card catalog-error catalog-state">
          <p className="auth-error" role="alert">
            No pudimos cargar la cotización.
          </p>
          <RefreshButton label="Reintentar" />
        </section>
      ) : null}

      {quote ? (
        <>
          <QuotePreview quote={quote} />
          <QuoteActions quote={quote} />
          <div className="flow-section quote-share-step" id="compartir">
            <QuoteSendStep quoteId={quote.id} status={quote.status} validUntil={quote.validUntil} />
            <ShareLinkSection
              quoteId={quote.id}
              status={quote.status}
              summary={{
                clientName: quote.client.name,
                number: quote.number,
                totalCop: quote.totals.totalCop,
                validUntil: quote.validUntil,
                version: quote.version,
              }}
            />
          </div>

          {/* Acciones a mano en celular: barra fija sobre la navegación (no se imprime). */}
          <div className="quote-quick-actions">
            <a className="secondary-button quote-quick-action" download href={`/api/quotes/${encodeURIComponent(quote.id)}/pdf`}>
              <Icon name="download" />
              PDF
            </a>
            <a className="auth-submit quote-quick-action" href="#compartir">
              <Icon name="share" />
              {shareable ? "Compartir" : "Enviar al cliente"}
            </a>
          </div>
        </>
      ) : null}
    </main>
  );

  return packageId ? (
    <div className="event-shell">
      <EventNav active="cotizar" packageId={packageId} />
      {content}
    </div>
  ) : (
    content
  );
}
