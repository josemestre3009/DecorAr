import type { ConfiguracionEvento } from "./event-configuration";

/**
 * Contrato canónico del patrón Prototype (DECOR-24 / docs/DecorAR.md sección 4.2).
 * Define la capacidad de duplicar una configuración completa sin reconstruirla paso a paso.
 */
export interface ConfiguracionClonable {
  clonar(nuevoId?: string, generarIdElemento?: () => string): ConfiguracionEvento;
}
