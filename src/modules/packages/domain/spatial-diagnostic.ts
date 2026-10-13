/** Diagnóstico espacial informativo (DECOR-44): nunca impide guardar cambios. */
export type EstadoEspacial = "pending" | "compatible" | "exceeded";

export interface DiagnosticoEspacial {
  readonly estado: EstadoEspacial;
  /** Área disponible declarada, o `null` cuando el evento aún no la registra. */
  readonly areaDisponibleM2: number | null;
  /** Área requerida por la configuración; siempre se calcula. */
  readonly areaRequeridaM2: number;
}

/**
 * Compara el área disponible con la requerida. Sin área disponible el estado
 * es `pending`; con ella es `compatible` o `exceeded`. Es un valor derivado,
 * no una regla de admisión.
 */
export function calcularDiagnosticoEspacial(
  areaDisponibleM2: number | null,
  areaRequeridaM2: number,
): DiagnosticoEspacial {
  if (areaDisponibleM2 === null) {
    return { areaDisponibleM2: null, areaRequeridaM2, estado: "pending" };
  }

  return {
    areaDisponibleM2,
    areaRequeridaM2,
    estado: areaRequeridaM2 > areaDisponibleM2 ? "exceeded" : "compatible",
  };
}
