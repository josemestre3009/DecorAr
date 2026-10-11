export interface CreatePackageGroupDto {
  readonly packageId: string;
  readonly userId: string;
  readonly name: string;
  readonly parentGroupId?: string | null;
  /** Módulos del catálogo que se agregan como hojas del grupo nuevo. */
  readonly moduleIds?: readonly string[];
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
}
