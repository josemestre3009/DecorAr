/** Estado de carga de la vista previa (DECOR-51) mientras el servidor lee la cotización. */
export default function QuoteLoading() {
  return (
    <main className="catalog-page quote-page">
      <div aria-live="polite" className="catalog-state" role="status">
        <span aria-hidden="true" className="spinner" />
        <p>Cargando la cotización…</p>
      </div>
    </main>
  );
}
