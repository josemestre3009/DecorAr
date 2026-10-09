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
  readonly parentGroupId?: string;
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
