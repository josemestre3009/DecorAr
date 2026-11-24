"use client";

/**
 * Imprimir/guardar como PDF en la página pública (DECOR-53). Mismo recurso
 * que usa el propietario en la vista previa (DECOR-51) mientras no exista una
 * ruta de PDF propia (DECOR-52).
 */
export function PrintButton() {
  return (
    <button className="secondary-button quote-action" onClick={() => window.print()} type="button">
      Imprimir / Guardar como PDF
    </button>
  );
}
