import type { QuoteLineDto } from "@/modules/quotes/application/dtos/quote.dto";
import type { QuoteTotals } from "@/modules/quotes/domain/quote";
import type { QuoteStatus } from "@/modules/quotes/domain/quote-status";

import { formatCop, formatEventDate } from "../../packages/_lib/format";
import { formatRateBp, quoteStatusLabel, quoteTitle } from "../_lib/quote-format";

/**
 * Lo mínimo que la vista previa necesita. `QuoteDto` (propietario, DECOR-51)
 * y `PublicQuoteDto` (enlace público, DECOR-53) la satisfacen ambos por
 * tipado estructural: el primero trae `status` y `moduleId` por línea, que
 * este componente ignora cuando faltan.
 */
export type QuotePreviewData = {
  readonly number: number;
  readonly version: number;
  readonly status?: QuoteStatus;
  readonly client: { readonly name: string | null };
  readonly event: {
    readonly name: string;
    readonly date: string | null;
    readonly venue: string | null;
    readonly type: string | null;
  };
  readonly validUntil: string;
  readonly conditions: string | null;
  readonly terms: {
    readonly discountRateBp: number;
    readonly taxRateBp: number;
    readonly depositRateBp: number;
  };
  readonly totals: QuoteTotals;
  readonly lines: readonly Omit<QuoteLineDto, "moduleId">[];
};

type QuotePreviewProps = {
  readonly quote: QuotePreviewData;
};

const NOT_DEFINED = "Sin definir";

/**
 * Vista previa de una versión de cotización (DECOR-51). Componente puro: solo
 * muestra lo que se guardó en `quotes`/`quote_lines` (precios y totales
 * congelados por el servidor); no recalcula nada. El PDF (DECOR-52) puede
 * reutilizar la misma estructura. El enlace público (DECOR-53) la reutiliza
 * sin mostrar el estado, que esa vista no recibe.
 */
export function QuotePreview({ quote }: QuotePreviewProps) {
  const { client, event, terms, totals } = quote;
  const validUntil = formatEventDate(quote.validUntil) ?? quote.validUntil;

  return (
    <article aria-label={quoteTitle(quote.number, quote.version)} className="quote-sheet">
      <header className="quote-sheet-header">
        <p className="quote-meta">
          {quote.status ? (
            <span className="quote-status" data-status={quote.status}>
              {quoteStatusLabel(quote.status)}
            </span>
          ) : null}
          <span>
            Válida hasta <time dateTime={quote.validUntil}>{validUntil}</time>
          </span>
        </p>
      </header>

      <section aria-labelledby="quote-parties-title" className="quote-section">
        <h2 className="section-title" id="quote-parties-title">
          Cliente y evento
        </h2>
        <dl className="quote-facts">
          <div>
            <dt>Cliente</dt>
            <dd>{client.name ?? NOT_DEFINED}</dd>
          </div>
          <div>
            <dt>Evento</dt>
            <dd>{event.name}</dd>
          </div>
          <div>
            <dt>Fecha</dt>
            <dd>{formatEventDate(event.date) ?? NOT_DEFINED}</dd>
          </div>
          <div>
            <dt>Lugar</dt>
            <dd>{event.venue ?? NOT_DEFINED}</dd>
          </div>
          <div>
            <dt>Tipo de evento</dt>
            <dd>{event.type ?? NOT_DEFINED}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="quote-lines-title" className="quote-section">
        <h2 className="section-title" id="quote-lines-title">
          Conceptos
        </h2>
        {quote.lines.length === 0 ? (
          <p className="catalog-empty quote-empty">Esta cotización no tiene conceptos.</p>
        ) : (
          <table className="quote-table">
            <caption className="visually-hidden">
              Conceptos de la cotización con cantidad, precio unitario y subtotal
            </caption>
            <thead>
              <tr>
                <th scope="col">Concepto</th>
                <th className="quote-num" scope="col">
                  Cantidad
                </th>
                <th className="quote-num" scope="col">
                  Precio unitario
                </th>
                <th className="quote-num" scope="col">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => (
                <tr key={line.position}>
                  <th className="quote-concept" scope="row">
                    {line.name}
                  </th>
                  <td className="quote-num" data-label="Cantidad">
                    {line.quantity}
                  </td>
                  <td className="quote-num" data-label="Precio unitario">
                    {formatCop(line.unitPriceCop)}
                  </td>
                  <td className="quote-num" data-label="Subtotal">
                    {formatCop(line.lineTotalCop)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="quote-totals-title" className="quote-section quote-totals">
        <h2 className="section-title" id="quote-totals-title">
          Totales
        </h2>
        <dl className="quote-totals-list">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatCop(totals.subtotalCop)}</dd>
          </div>
          <div>
            <dt>Descuento ({formatRateBp(terms.discountRateBp)})</dt>
            <dd>{totals.discountCop > 0 ? `− ${formatCop(totals.discountCop)}` : formatCop(0)}</dd>
          </div>
          <div>
            <dt>Base gravable</dt>
            <dd>{formatCop(totals.taxableBaseCop)}</dd>
          </div>
          <div>
            <dt>Impuestos ({formatRateBp(terms.taxRateBp)})</dt>
            <dd>{formatCop(totals.taxCop)}</dd>
          </div>
          <div className="quote-grand-total">
            <dt>Total</dt>
            <dd>{formatCop(totals.totalCop)}</dd>
          </div>
          <div>
            <dt>Anticipo ({formatRateBp(terms.depositRateBp)} del total)</dt>
            <dd>{formatCop(totals.depositCop)}</dd>
          </div>
        </dl>
      </section>

      {quote.conditions ? (
        <section aria-labelledby="quote-conditions-title" className="quote-section">
          <h2 className="section-title" id="quote-conditions-title">
            Condiciones
          </h2>
          <p className="quote-conditions">{quote.conditions}</p>
        </section>
      ) : null}
    </article>
  );
}
