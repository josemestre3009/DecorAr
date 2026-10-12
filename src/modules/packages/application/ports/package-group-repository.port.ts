import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { PackageModuleAddedEvent } from "../../../events/domain/event-contracts";

export interface PackageGroupSummary {
  readonly groupId: string;
  readonly name: string;
  readonly parentGroupId: string | null;
}

/** Grupos del paquete y el grupo de cada hoja (`null` = raíz del paquete). */
export interface PackageStructure {
  readonly groups: readonly PackageGroupSummary[];
  readonly itemGroupIds: Readonly<Record<string, string | null>>;
}

export interface CreatePackageGroupCommand {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
  readonly name: string;
  readonly parentGroupId: string | null;
  /** Un `package.module.added` por hoja; se confirman en la misma transacción. */
  readonly events: readonly PackageModuleAddedEvent[];
  readonly expectedVersion: number;
  /** Se guarda en cada fila del outbox y en los logs de recuperación (DECOR-31). */
  readonly correlationId?: string | null;
}

export interface CreatedGroupRecord {
  readonly groupId: string;
  readonly depth: number;
  readonly itemIds: readonly string[];
  readonly packageVersion: number;
}

export interface RenamePackageGroupCommand {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
  readonly name: string;
  readonly expectedVersion: number;
}

export interface RenamedGroupRecord {
  readonly groupId: string;
  readonly name: string;
  readonly structureVersion: number;
}

export interface DeletePackageGroupCommand {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
  readonly expectedVersion: number;
}

export interface DeletedGroupRecord {
  readonly groupId: string;
  /** Destino del contenido promovido: el padre del grupo, o `null` (raíz). */
  readonly parentGroupId: string | null;
  readonly promotedGroups: number;
  readonly promotedItems: number;
  readonly structureVersion: number;
}

export interface PackageGroupReader {
  getStructure(packageId: string): Promise<Result<PackageStructure, DomainError>>;
}

/**
 * Escrituras atómicas del Composite. Cada operación es una sola transacción
 * PostgreSQL: si falla una hoja no queda ni el grupo ni ningún evento.
 */
export interface PackageGroupRepository {
  createGroup(command: CreatePackageGroupCommand): Promise<Result<CreatedGroupRecord, DomainError>>;
  addItemToGroup(
    event: PackageModuleAddedEvent,
    groupId: string,
    expectedVersion: number,
    correlationId?: string,
  ): Promise<Result<number, DomainError>>;
  /** Cambia solo el nombre; sube la versión estructural, no la del paquete. */
  renameGroup(command: RenamePackageGroupCommand): Promise<Result<RenamedGroupRecord, DomainError>>;
  /**
   * Borra el grupo y promueve sus hojas y subgrupos al padre en una sola
   * transacción. No emite eventos de módulo ni recalcula el presupuesto.
   */
  deleteGroup(command: DeletePackageGroupCommand): Promise<Result<DeletedGroupRecord, DomainError>>;
}
