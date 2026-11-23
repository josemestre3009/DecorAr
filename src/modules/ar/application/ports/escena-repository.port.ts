import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { TransformacionItem } from "../../domain/escena-montaje";

export interface EscenaRecord {
  readonly packageId: string;
  readonly sceneVersion: number;
  readonly transformaciones: readonly TransformacionItem[];
}

export interface GuardarEscenaCommand {
  readonly packageId: string;
  readonly userId: string;
  readonly transformaciones: readonly TransformacionItem[];
  /** Obligatoria: sin ella no se puede detectar un guardado concurrente. */
  readonly expectedSceneVersion: number;
}

/**
 * Persistencia de la escena (DECOR-46). `guardar` reemplaza todas las
 * posiciones del paquete en una sola operación atómica, sin tocar
 * `packages.version`, el outbox ni el presupuesto.
 */
export interface EscenaRepository {
  leer(packageId: string): Promise<Result<EscenaRecord, DomainError>>;
  guardar(command: GuardarEscenaCommand): Promise<Result<number, DomainError>>;
}
