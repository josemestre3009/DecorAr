import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createSharedQuoteQueryDependencies } from "@/composition/server";

import { QuotePreview } from "../../../(protected)/quotes/[quoteId]/quote-preview";
import { PrintButton } from "./print-button";

// Metadatos genéricos a propósito: WhatsApp y otros clientes descargan esta
// URL para generar su vista previa, y no deben filtrar nombre del cliente,
// evento ni montos (DECOR-53).
export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Cotización compartida · DecorAR",
};

type SharedQuotePageProps = {
  readonly params: Promise<{ readonly token: string }>;
};

/**
 * Lectura pública de una cotización por enlace (DECOR-53). Sin sesión: un
 * token con formato inválido, inexistente, vencido, revocado o de una
 * cotización que ya no es `sent`/`accepted` produce la misma página de "no
 * encontrado", sin distinguir el motivo.
 */
export default async function SharedQuotePage({ params }: SharedQuotePageProps) {
  const { token } = await params;
  const { getSharedQuote } = createSharedQuoteQueryDependencies();

  const result = await getSharedQuote.execute(token);
  if (!result.ok) {
    if (result.error.code === "quote.share_link_not_found") notFound();
    console.error(`[SharedQuotePage] No se pudo leer la cotización compartida (${randomUUID()}):`, result.error.code);
    notFound();
  }

  const quote = result.value;

  return (
    <main className="catalog-page quote-page">
      <header className="catalog-header">
        <p className="page-lead">Esta es una vista de solo lectura de la cotización que te compartieron.</p>
      </header>

      <QuotePreview quote={quote} />

      <section aria-labelledby="quote-actions-title" className="configurator-card quote-actions">
        <h2 className="section-title" id="quote-actions-title">
          Guardar esta cotización
        </h2>
        <PrintButton />
      </section>
    </main>
  );
}
