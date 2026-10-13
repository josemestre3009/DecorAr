import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { isTipoEspacio } from "../../modules/packages/domain/space-type";
import type {
  CreatedEventTemplateDto,
  InstantiatedEventDto,
  RenamedEventTemplateDto,
} from "../../modules/packages/application/dtos/event-template.dto";
import type {
  CreateEventTemplateFromPackageParams,
  DeleteEventTemplateParams,
  EventTemplateRepository,
  InstantiateEventFromTemplateParams,
  RenameEventTemplateParams,
} from "../../modules/packages/application/ports/event-template-repository.port";

/** Códigos que los RPC de plantilla/copia emiten de forma estable. */
const KNOWN_CODES = new Set([
  "auth.unauthenticated",
  "package.not_found",
  "package.invalid_user",
  "package.invalid_source",
  "package.invalid_name",
  "package.invalid_space_type",
  "package.invalid_capacity",
  "template.not_found",
  "template.invalid_source",
  "template.invalid_name",
  "template.group_not_found",
  "template.group_depth_exceeded",
  "template.group_immutable",
]);

type RpcRow = {
  id: string;
  name?: string | null;
  spaceType?: unknown;
  space_type?: unknown;
  capacityM2?: number | string | null;
  capacity_m2?: number | string | null;
  eventType?: string | null;
  event_type?: string | null;
  style?: string | null;
  colors?: unknown;
  notes?: string | null;
  version?: number;
  itemCount?: number;
  groupCount?: number;
};

const readCapacity = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

const readColors = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((color): color is string => typeof color === "string") : [];

function mapConfig(row: RpcRow) {
  const spaceType = row.spaceType ?? row.space_type;
  return {
    capacityM2: readCapacity(row.capacityM2 ?? row.capacity_m2),
    colors: readColors(row.colors),
    eventType: row.eventType ?? row.event_type ?? null,
    id: row.id,
    name: row.name ?? "",
    notes: row.notes ?? "",
    spaceType: isTipoEspacio(spaceType) ? spaceType : null,
    style: row.style ?? null,
  } as const;
}

function mapCreated(row: RpcRow): CreatedEventTemplateDto {
  return {
    ...mapConfig(row),
    groupCount: Number(row.groupCount ?? 0),
    itemCount: Number(row.itemCount ?? 0),
  };
}

function mapInstantiated(row: RpcRow): InstantiatedEventDto {
  return {
    ...mapConfig(row),
    groupCount: Number(row.groupCount ?? 0),
    itemCount: Number(row.itemCount ?? 0),
    version: Number(row.version ?? 1),
  };
}

/**
 * Mutaciones atómicas de plantillas (DECOR-44). Se construye con el cliente
 * service_role: los RPC son `SECURITY INVOKER`, no conceden escritura directa a
 * anon/authenticated y vuelven a comprobar la propiedad dentro de la
 * transacción, así que un recurso ajeno o inexistente emite el mismo
 * `*.not_found`.
 */
export class SupabaseEventTemplateRepository implements EventTemplateRepository {
  constructor(private readonly client: SupabaseClient) {}

  private toError(error: { message: string }, fallback: string): DomainError {
    if (KNOWN_CODES.has(error.message)) {
      return new DomainError(error.message, error.message, { cause: error });
    }
    return new DomainError("template.persistence_error", error.message || fallback, { cause: error });
  }

  async createFromPackage(
    params: CreateEventTemplateFromPackageParams,
  ): Promise<Result<CreatedEventTemplateDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("create_event_template_from_package", {
        p_name: params.name,
        p_owner_id: params.ownerId,
        p_source_package_id: params.packageId,
      });

      if (error) return err(this.toError(error, "Error al crear la plantilla"));
      if (!data) {
        return err(new DomainError("template.persistence_error", "RPC create_event_template_from_package returned no data"));
      }

      return ok(mapCreated(data as RpcRow));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al crear la plantilla";
      return err(new DomainError("template.persistence_error", message, { cause }));
    }
  }

  async instantiate(
    params: InstantiateEventFromTemplateParams,
  ): Promise<Result<InstantiatedEventDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("create_package_from_event_template", {
        p_event_name: params.name,
        p_owner_id: params.ownerId,
        p_template_id: params.templateId,
      });

      if (error) return err(this.toError(error, "Error al crear el evento"));
      if (!data) {
        return err(new DomainError("template.persistence_error", "RPC create_package_from_event_template returned no data"));
      }

      return ok(mapInstantiated(data as RpcRow));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al crear el evento";
      return err(new DomainError("template.persistence_error", message, { cause }));
    }
  }

  async rename(
    params: RenameEventTemplateParams,
  ): Promise<Result<RenamedEventTemplateDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("rename_event_template", {
        p_name: params.name,
        p_owner_id: params.ownerId,
        p_template_id: params.templateId,
      });

      if (error) return err(this.toError(error, "Error al renombrar la plantilla"));
      if (!data) {
        return err(new DomainError("template.persistence_error", "RPC rename_event_template returned no data"));
      }

      const row = data as { id: string; name?: string | null };
      return ok({ id: row.id, name: row.name ?? "" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al renombrar la plantilla";
      return err(new DomainError("template.persistence_error", message, { cause }));
    }
  }

  async delete(params: DeleteEventTemplateParams): Promise<Result<boolean, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("delete_event_template", {
        p_owner_id: params.ownerId,
        p_template_id: params.templateId,
      });

      if (error) return err(this.toError(error, "Error al eliminar la plantilla"));

      return ok(data === true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al eliminar la plantilla";
      return err(new DomainError("template.persistence_error", message, { cause }));
    }
  }
}
