import type { TipoEspacio } from "../../domain/space-type";

export const MAX_BATCH_QUANTITY = 100;

/** Estado del diagnóstico espacial informativo (DECOR-44). */
export type SpatialStatus = "pending" | "compatible" | "exceeded";

export interface SpatialDiagnosticDto {
  readonly status: SpatialStatus;
  /** Área disponible declarada, o `null` si el evento aún no la registra. */
  readonly availableM2: number | null;
  /** Área requerida por la configuración. */
  readonly requiredM2: number;
}

/**
 * Metadatos visibles de un evento (persistido como `package`). Solo `name` es
 * obligatorio; el resto puede quedar ausente y completarse después.
 */
export interface EventMetadataDto {
  readonly name: string;
  readonly clientName: string | null;
  readonly eventDate: string | null;
  readonly venue: string | null;
  readonly eventType: string | null;
  readonly spaceType: TipoEspacio | null;
  readonly capacityM2: number | null;
}

export interface CreatePackageDto {
  readonly userId: string;
  readonly name: unknown;
  readonly clientName?: unknown;
  readonly eventDate?: unknown;
  readonly venue?: unknown;
  readonly eventType?: unknown;
  readonly spaceType?: unknown;
  readonly capacityM2?: unknown;
}

export interface CreatedPackageDto extends EventMetadataDto {
  readonly id: string;
  readonly spatial: SpatialDiagnosticDto;
}

/** Parche parcial: una clave ausente no se modifica; `null` borra el dato. */
export interface PackageMetadataPatch {
  readonly name?: string;
  readonly clientName?: string | null;
  readonly eventDate?: string | null;
  readonly venue?: string | null;
  readonly eventType?: string | null;
  readonly spaceType?: TipoEspacio | null;
  readonly capacityM2?: number | null;
}

export interface UpdatePackageMetadataDto {
  readonly packageId: string;
  readonly userId: string;
  readonly patch: PackageMetadataPatch;
}

export interface AddModuleToPackageDto {
  readonly packageId: string;
  readonly userId: string;
  readonly moduleId: string;
  readonly quantity?: number;
  /** Propagated to the outbox row and the recovery logs (DECOR-31); never part of the event contract. */
  readonly correlationId?: string;
}

export interface AddedItemDto {
  readonly itemId: string;
  readonly itemIds?: readonly string[];
  readonly packageVersion: number;
}

export interface RemoveModuleFromPackageDto {
  readonly packageId: string;
  readonly userId: string;
  readonly itemId: string;
  /** Propagated to the outbox row and the recovery logs (DECOR-31); never part of the event contract. */
  readonly correlationId?: string;
}

export interface ClonePackageDto {
  readonly sourcePackageId: string;
  readonly userId: string;
}

export interface ClonedPackageDto {
  readonly id: string;
  readonly spaceType: TipoEspacio | null;
  readonly capacityM2: number | null;
  readonly style?: string | null;
  readonly colors?: readonly string[];
  readonly notes?: string;
  readonly version: number;
  readonly itemCount: number;
}
