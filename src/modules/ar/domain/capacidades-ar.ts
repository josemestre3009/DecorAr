export type PlataformaAR = "ios" | "android" | "otra";

/**
 * Lo que el dispositivo ofrece para AR. El dominio no lee `navigator`: la
 * interfaz detecta las capacidades y se las entrega ya resueltas.
 */
export interface CapacidadesAR {
  readonly plataforma: PlataformaAR;
  /** `navigator.xr` admite sesiones `immersive-ar`. */
  readonly webxr: boolean;
}

export const SIN_CAPACIDADES_AR: CapacidadesAR = Object.freeze({
  plataforma: "otra",
  webxr: false,
});
