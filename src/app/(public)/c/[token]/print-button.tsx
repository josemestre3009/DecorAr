"use client";

/**
 * Imprimir en la página pública (DECOR-53), como complemento a la descarga
 * directa del PDF (DECOR-56).
 */
export function PrintButton() {
  return (
    <button className="secondary-button quote-action" onClick={() => window.print()} type="button">
      Imprimir / Guardar como PDF
    </button>
  );
}
