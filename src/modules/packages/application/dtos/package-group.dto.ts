export interface CreatePackageGroupDto {
  readonly packageId: string;
  readonly userId: string;
  readonly name: string;
  readonly parentGroupId?: string | null;
  /** Módulos del catálogo que se agregan como hojas del grupo nuevo. */
  readonly moduleIds?: readonly string[];
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

export interface RenamePackageGroupDto {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
  readonly name: string;
}

export interface RenamedPackageGroupDto {
  readonly groupId: string;
  readonly name: string;
  readonly structureVersion: number;
}

export interface DeletePackageGroupDto {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
}

export interface DeletedPackageGroupDto {
  readonly groupId: string;
  readonly parentGroupId: string | null;
  readonly promotedGroups: number;
  readonly promotedItems: number;
  readonly structureVersion: number;
}
