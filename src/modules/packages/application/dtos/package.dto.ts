import type { TipoEspacio } from "../../domain/space-type";

export const MAX_BATCH_QUANTITY = 100;

export interface CreatePackageDto {
  readonly userId: string;
  readonly spaceType: string;
  readonly capacityM2: number;
}

export interface CreatedPackageDto {
  readonly id: string;
  readonly spaceType: TipoEspacio;
  readonly capacityM2: number;
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
  readonly spaceType: TipoEspacio;
  readonly capacityM2: number;
  readonly style?: string | null;
  readonly colors?: readonly string[];
  readonly notes?: string;
  readonly version: number;
  readonly itemCount: number;
}

