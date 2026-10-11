import type { TipoEspacio } from "../../domain/space-type";

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
}

export interface AddedItemDto {
  readonly itemId: string;
  readonly packageVersion: number;
}

export interface RemoveModuleFromPackageDto {
  readonly packageId: string;
  readonly userId: string;
  readonly itemId: string;
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

