export interface CreatePackageGroupDto {
  readonly packageId: string;
  readonly userId: string;
  readonly name: string;
  readonly parentGroupId?: string | null;
  /** Módulos del catálogo que se agregan como hojas del grupo nuevo. */
  readonly moduleIds?: readonly string[];
  readonly expectedVersion?: number;
  /** Propagated to the outbox rows and the recovery logs (DECOR-31); never part of the event contract. */
  readonly correlationId?: string;
}

export interface CreatedPackageGroupDto {
  readonly groupId: string;
  readonly name: string;
  readonly parentGroupId: string | null;
  readonly depth: number;
  readonly itemIds: readonly string[];
  readonly packageVersion: number;
}

export interface AddModuleToGroupDto {
  readonly packageId: string;
  readonly userId: string;
  readonly moduleId: string;
  readonly groupId: string;
  /** Propagated to the outbox row and the recovery logs (DECOR-31); never part of the event contract. */
  readonly correlationId?: string;
}

/** Estrategia explícita de eliminación de una zona. */
export type DeletePackageGroupStrategy = "move_to_root" | "delete_contents";

export interface UpdatePackageGroupDto {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
  /** Nombre nuevo recortado (1..80); ausente para no renombrar. */
  readonly name?: string;
  /** Padre nuevo (`null` = raíz); ausente para no mover. */
  readonly parentGroupId?: string | null;
  readonly expectedVersion?: number;
  readonly correlationId?: string;
}

export interface UpdatedPackageGroupDto {
  readonly groupId: string;
  readonly name: string;
  readonly parentGroupId: string | null;
  readonly packageVersion: number;
}

export interface DeletePackageGroupDto {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
  readonly strategy: DeletePackageGroupStrategy;
  readonly expectedVersion?: number;
  readonly correlationId?: string;
}

export interface DeletedPackageGroupDto {
  readonly groupId: string;
  readonly strategy: DeletePackageGroupStrategy;
  readonly packageVersion: number;
}

export interface MovePackageItemDto {
  readonly packageId: string;
  readonly userId: string;
  readonly itemId: string;
  /** Destino (`null` = raíz). */
  readonly groupId: string | null;
  readonly expectedVersion?: number;
  readonly correlationId?: string;
}

export interface MovedPackageItemDto {
  readonly itemId: string;
  readonly groupId: string | null;
  readonly packageVersion: number;
}
