import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { QuoteLineSnapshot } from "../../domain/quote";

/**
 * Instantánea del evento a cotizar: su versión actual y sus conceptos
 * agrupados por módulo (cantidad = unidades en el paquete; nombre y precio
 * del catálogo en el momento de la lectura).
 */
export type QuoteSource = {
  readonly packageId: string;
  readonly packageVersion: number;
  readonly lines: readonly QuoteLineSnapshot[];
};

/**
 * Lee el evento sin que `quotes` importe el módulo `packages` (igual que
 * `budget`). `null` cuando el paquete no existe o no pertenece al dueño.
 */
export interface QuoteSourceReader {
  read(packageId: string, ownerId: string): Promise<Result<QuoteSource | null, DomainError>>;
}
