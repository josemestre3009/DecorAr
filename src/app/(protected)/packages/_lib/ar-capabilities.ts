import type { CapacidadesAR, PlataformaAR } from "@/modules/ar/domain/capacidades-ar";

/** Lo mínimo de `navigator` que hace falta; se inyecta en las pruebas. */
export type NavigatorAR = {
  readonly userAgent: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
  readonly xr?: { isSessionSupported(mode: string): Promise<boolean> };
};

export function detectarPlataforma(nav: NavigatorAR): PlataformaAR {
  const ua = nav.userAgent;

  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS se anuncia como Mac de escritorio; lo delata la pantalla táctil.
  if (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1) return "ios";
  if (/Android/i.test(ua)) return "android";

  return "otra";
}

/**
 * Detecta qué ofrece el dispositivo para AR. Es una preferencia para elegir el
 * renderizador: `<model-viewer>` vuelve a comprobar si puede abrir el visor
 * (`canActivateAR`) y la pantalla avisa si no.
 */
export async function detectarCapacidadesAR(nav: NavigatorAR): Promise<CapacidadesAR> {
  let webxr = false;

  try {
    webxr = (await nav.xr?.isSessionSupported("immersive-ar")) === true;
  } catch {
    // Política de permisos o navegador sin WebXR: se sigue sin AR web.
    webxr = false;
  }

  return { plataforma: detectarPlataforma(nav), webxr };
}
