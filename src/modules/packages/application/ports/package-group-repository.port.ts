import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type {
  PackageModuleAddedEvent,
  PackageModuleMovedEvent,
  PackageModuleRemovedEvent,
} from "../../../events/domain/event-contracts";
import type { DeletePackageGroupStrategy } from "../dtos/package-group.dto";

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
}

/** Eventos que acompañan una edición estructural masiva dentro de una RPC. */
export type PackageStructureEditEvent = PackageModuleRemovedEvent | PackageModuleMovedEvent;

export interface UpdatePackageGroupCommand {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
  /** Nombre final recortado; se omite cuando la operación no renombra. */
  readonly name?: string;
  /** Padre final (`null` = raíz); se omite cuando la operación no mueve. */
  readonly parentGroupId?: string | null;
  readonly expectedVersion: number;
  readonly correlationId?: string | null;
}

export interface DeletePackageGroupCommand {
  readonly packageId: string;
  readonly userId: string;
  readonly groupId: string;
  readonly strategy: DeletePackageGroupStrategy;
  /** Un `removed` por hoja o un `moved` por hoja directa, en la misma transacción. */
  readonly events: readonly PackageStructureEditEvent[];
  readonly expectedVersion: number;
  readonly correlationId?: string | null;
}

export interface MovePackageItemCommand {
  readonly packageId: string;
  readonly userId: string;
  readonly itemId: string;
  /** Destino (`null` = raíz). */
  readonly groupId: string | null;
  readonly event: PackageModuleMovedEvent;
  readonly expectedVersion: number;
  readonly correlationId?: string | null;
}

/**
 * RPC de edición estructural (renombrar/mover zona, eliminar con estrategia y
 * mover instancia). Cada una bloquea el evento, compara `expectedVersion` y
 * confirma todos los cambios o ninguno; devuelve la nueva versión del evento.
 */
export interface PackageStructureEditorRepository {
  updateGroup(command: UpdatePackageGroupCommand): Promise<Result<number, DomainError>>;
  deleteGroup(command: DeletePackageGroupCommand): Promise<Result<number, DomainError>>;
  moveItem(command: MovePackageItemCommand): Promise<Result<number, DomainError>>;
}
