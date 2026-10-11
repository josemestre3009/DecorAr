import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type {
  CreatedGroupRecord,
  CreatePackageGroupCommand,
  PackageGroupReader,
  PackageGroupRepository,
  PackageStructure,
} from "../../modules/packages/application/ports/package-group-repository.port";
import type { PackageModuleAddedEvent } from "../../modules/events/domain/event-contracts";

/**
 * Codes raised with RAISE EXCEPTION by create_package_group,
 * add_package_item_to_group and the commit_package_change they reuse, with
 * the message shown to the user (the SQL only raises the code).
 */
const KNOWN_CODES: ReadonlyMap<string, string> = new Map([
  ["package.not_found", "No encontramos este paquete."],
  ["package.invalid_group", "El grupo no es válido."],
  ["package.invalid_group_name", "El nombre del grupo debe tener entre 1 y 80 caracteres."],
  ["package.group_not_found", "No encontramos ese grupo en el paquete."],
  ["package.group_depth_exceeded", "Los grupos admiten como máximo 3 niveles."],
  ["package.group_immutable", "No se puede mover un grupo a otra posición."],
  ["package.version_conflict", "El paquete cambió mientras guardabas. Vuelve a intentarlo."],
  ["package.item_not_found", "No encontramos este elemento en el paquete."],
  ["event.duplicate", "Esta operación ya se registró."],
  ["event.invalid", "No pudimos registrar el cambio del paquete."],
  ["event.unsupported_type", "No pudimos registrar el cambio del paquete."],
  ["event.unsupported_version", "No pudimos registrar el cambio del paquete."],
]);

const FOREIGN_KEY_VIOLATION = "23503";
/** Postgres `invalid_text_representation`: a malformed uuid reached the query. */
const INVALID_TEXT_REPRESENTATION = "22P02";

type RpcError = { readonly code?: string; readonly message: string };

type RpcCreatedGroup = {
  groupId: string;
  depth: number;
  itemIds: string[];
  packageVersion: number;
};

const persistenceError = (cause: unknown, fallback: string): DomainError =>
  new DomainError(
    "package.persistence_error",
    typeof cause === "object" && cause !== null && "message" in cause
      ? String((cause as { message: unknown }).message)
      : fallback,
    { cause },
  );

const toDomainError = (error: RpcError): DomainError => {
  const knownMessage = KNOWN_CODES.get(error.message);
  if (knownMessage) {
    return new DomainError(error.message, knownMessage, { cause: error });
  }

  if (error.code === FOREIGN_KEY_VIOLATION) {
    return new DomainError("package.module_not_found", "El módulo no existe en el catálogo", { cause: error });
  }

  // Un uuid mal formado (grupo, paquete o ítem) no debe confundirse con "no encontrado".
  if (error.code === INVALID_TEXT_REPRESENTATION) {
    return new DomainError("package.invalid_group", "El identificador enviado no es válido.", { cause: error });
  }

  return persistenceError(error, "Error inesperado al guardar el grupo");
};

/**
 * Server-only adapter for the Composite RPCs (DECOR-25). Must be built with
 * the service-role client: the RPCs deny anon/authenticated, and the Route
 * Handler already checked the session and package ownership.
 */
export class SupabasePackageGroupRepository implements PackageGroupReader, PackageGroupRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getStructure(packageId: string): Promise<Result<PackageStructure, DomainError>> {
    try {
      const { data: groups, error: groupsError } = await this.client
        .from("package_groups")
        .select("id, name, parent_group_id")
        .eq("package_id", packageId);

      if (groupsError) {
        return err(persistenceError(groupsError, "Error al consultar grupos"));
      }

      const { data: items, error: itemsError } = await this.client
        .from("package_items")
        .select("id, group_id")
        .eq("package_id", packageId);

      if (itemsError) {
        return err(persistenceError(itemsError, "Error al consultar elementos"));
      }

      const groupRows = (groups ?? []) as { id: string; name: string; parent_group_id: string | null }[];
      const itemRows = (items ?? []) as { id: string; group_id: string | null }[];

      return ok({
        groups: groupRows.map((row) => ({
          groupId: row.id,
          name: row.name,
          parentGroupId: row.parent_group_id,
        })),
        itemGroupIds: Object.fromEntries(itemRows.map((row) => [row.id, row.group_id])),
      });
    } catch (cause) {
      return err(persistenceError(cause, "Error al consultar la estructura del paquete"));
    }
  }

  async createGroup(command: CreatePackageGroupCommand): Promise<Result<CreatedGroupRecord, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("create_package_group", {
        p_correlation_id: command.correlationId ?? null,
        p_events: command.events,
        p_expected_version: command.expectedVersion,
        p_group_id: command.groupId,
        p_name: command.name,
        p_package_id: command.packageId,
        p_parent_group_id: command.parentGroupId,
        p_user_id: command.userId,
      });

      if (error) {
        return err(toDomainError(error));
      }

      if (!data) {
        return err(persistenceError(null, "RPC create_package_group returned no data"));
      }

      const row = data as RpcCreatedGroup;
      return ok({
        depth: Number(row.depth),
        groupId: row.groupId,
        itemIds: Array.isArray(row.itemIds) ? row.itemIds : [],
        packageVersion: Number(row.packageVersion),
      });
    } catch (cause) {
      return err(persistenceError(cause, "Error inesperado al crear el grupo"));
    }
  }

  async addItemToGroup(
    event: PackageModuleAddedEvent,
    groupId: string,
    expectedVersion: number,
    correlationId?: string,
  ): Promise<Result<number, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("add_package_item_to_group", {
        p_correlation_id: correlationId ?? null,
        p_event: event,
        p_expected_version: expectedVersion,
        p_group_id: groupId,
      });

      if (error) {
        return err(toDomainError(error));
      }

      if (typeof data !== "number") {
        return err(persistenceError(null, "RPC add_package_item_to_group returned no version"));
      }

      return ok(data);
    } catch (cause) {
      return err(persistenceError(cause, "Error inesperado al agregar el elemento al grupo"));
    }
  }
}
