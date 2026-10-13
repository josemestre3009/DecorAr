import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { calcularDiagnosticoEspacial } from "../../modules/packages/domain/spatial-diagnostic";
import { isTipoEspacio } from "../../modules/packages/domain/space-type";
import type {
  ClonedPackageDto,
  ClonePackageDto,
  CreatedPackageDto,
  EventMetadataDto,
  SpatialDiagnosticDto,
} from "../../modules/packages/application/dtos/package.dto";
import type {
  CreatePackageParams,
  PackageRepository,
  UpdatePackageMetadataParams,
} from "../../modules/packages/application/ports/package-repository.port";

const KNOWN_CODES = new Set([
  "package.invalid_user",
  "package.invalid_space_type",
  "package.invalid_capacity",
  "package.invalid_name",
  "package.invalid_client_name",
  "package.invalid_event_date",
  "package.invalid_venue",
  "package.invalid_event_type",
  "package.invalid_source",
  "package.not_found",
]);

type RpcPackageRow = {
  id: string;
  name?: string | null;
  spaceType?: unknown;
  space_type?: unknown;
  capacityM2?: number | string | null;
  capacity_m2?: number | string | null;
  clientName?: string | null;
  client_name?: string | null;
  eventDate?: string | null;
  event_date?: string | null;
  venue?: string | null;
  eventType?: string | null;
  event_type?: string | null;
};

type RpcClonedPackageRow = {
  id: string;
  spaceType?: unknown;
  space_type?: unknown;
  capacityM2?: number | string | null;
  capacity_m2?: number | string | null;
  style?: string | null;
  colors?: string[];
  notes?: string;
  version?: number;
  itemCount?: number;
};

type ItemAreaRow = {
  catalog_modules: { area_m2: number | string } | { area_m2: number | string }[] | null;
};

const toSpatial = (capacityM2: number | null, requiredM2: number): SpatialDiagnosticDto => {
  const diagnostico = calcularDiagnosticoEspacial(capacityM2, requiredM2);
  return {
    availableM2: diagnostico.areaDisponibleM2,
    requiredM2: diagnostico.areaRequeridaM2,
    status: diagnostico.estado,
  };
};

const readSpaceType = (value: unknown) => (isTipoEspacio(value) ? value : null);

const readCapacity = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

const readText = (value: string | null | undefined): string | null =>
  value === null || value === undefined ? null : value;

function mapMetadata(row: RpcPackageRow): EventMetadataDto {
  return {
    capacityM2: readCapacity(row.capacityM2 ?? row.capacity_m2),
    clientName: readText(row.clientName ?? row.client_name),
    eventDate: readText(row.eventDate ?? row.event_date),
    eventType: readText(row.eventType ?? row.event_type),
    name: row.name ?? "",
    spaceType: readSpaceType(row.spaceType ?? row.space_type),
    venue: readText(row.venue),
  };
}

function toCreatedPackage(row: RpcPackageRow, requiredM2: number): CreatedPackageDto {
  const metadata = mapMetadata(row);
  return {
    ...metadata,
    id: row.id,
    spatial: toSpatial(metadata.capacityM2, requiredM2),
  };
}

export class SupabasePackageRepository implements PackageRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(params: CreatePackageParams): Promise<Result<CreatedPackageDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("create_package", {
        p_capacity_m2: params.capacityM2,
        p_client_name: params.clientName,
        p_event_date: params.eventDate,
        p_event_type: params.eventType,
        p_name: params.name,
        p_space_type: params.spaceType,
        p_user_id: params.userId,
        p_venue: params.venue,
      });

      if (error) {
        if (KNOWN_CODES.has(error.message)) {
          return err(new DomainError(error.message, error.message, { cause: error }));
        }
        return err(
          new DomainError("package.persistence_error", error.message, { cause: error }),
        );
      }

      if (!data) {
        return err(
          new DomainError("package.persistence_error", "RPC create_package returned no data"),
        );
      }

      // Un evento recién creado no tiene elementos: su área requerida es 0.
      return ok(toCreatedPackage(data as RpcPackageRow, 0));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al crear el paquete";
      return err(new DomainError("package.persistence_error", message, { cause }));
    }
  }

  async updateMetadata(params: UpdatePackageMetadataParams): Promise<Result<CreatedPackageDto, DomainError>> {
    try {
      const { patch } = params;
      const updates: Record<string, unknown> = {};

      const { data: itemsData, error: itemsError } = await this.client
        .from("package_items")
        .select("catalog_modules(area_m2)")
        .eq("package_id", params.packageId);

      if (itemsError) {
        return err(new DomainError("package.persistence_error", itemsError.message, { cause: itemsError }));
      }

      const requiredM2 = ((itemsData as unknown as ItemAreaRow[]) ?? []).reduce((total, row) => {
        const area = Array.isArray(row.catalog_modules)
          ? row.catalog_modules[0]?.area_m2
          : row.catalog_modules?.area_m2;
        return total + Number(area ?? 0);
      }, 0);

      if (patch.name !== undefined) updates.name = patch.name;
      if (patch.clientName !== undefined) updates.client_name = patch.clientName;
      if (patch.eventDate !== undefined) updates.event_date = patch.eventDate;
      if (patch.venue !== undefined) updates.venue = patch.venue;
      if (patch.eventType !== undefined) updates.event_type = patch.eventType;
      if (patch.spaceType !== undefined) updates.space_type = patch.spaceType;
      if (patch.capacityM2 !== undefined) updates.capacity_m2 = patch.capacityM2;
      if (Object.keys(updates).length > 0) updates.updated_at = new Date().toISOString();

      const columns =
        "id, name, space_type, capacity_m2, client_name, event_date, venue, event_type";
      // Un parche vacío no debe enviar un UPDATE sin columnas: se lee tal cual.
      const { data, error } =
        Object.keys(updates).length > 0
          ? await this.client
              .from("packages")
              .update(updates)
              .eq("id", params.packageId)
              .eq("user_id", params.userId)
              .select(columns)
              .maybeSingle()
          : await this.client
              .from("packages")
              .select(columns)
              .eq("id", params.packageId)
              .eq("user_id", params.userId)
              .maybeSingle();

      if (error) {
        return err(new DomainError("package.persistence_error", error.message, { cause: error }));
      }

      if (!data) {
        return err(new DomainError("package.not_found", "No encontramos este evento."));
      }

      return ok(toCreatedPackage(data as RpcPackageRow, requiredM2));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al actualizar el evento";
      return err(new DomainError("package.persistence_error", message, { cause }));
    }
  }

  async clone(params: ClonePackageDto): Promise<Result<ClonedPackageDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("clone_package", {
        p_source_package_id: params.sourcePackageId,
        p_target_user_id: params.userId,
      });

      if (error) {
        if (KNOWN_CODES.has(error.message)) {
          return err(new DomainError(error.message, error.message, { cause: error }));
        }
        return err(
          new DomainError("package.persistence_error", error.message, { cause: error }),
        );
      }

      if (!data) {
        return err(
          new DomainError("package.persistence_error", "RPC clone_package returned no data"),
        );
      }

      const row = data as RpcClonedPackageRow;
      return ok({
        capacityM2: readCapacity(row.capacityM2 ?? row.capacity_m2),
        colors: Array.isArray(row.colors) ? row.colors : [],
        id: row.id,
        itemCount: Number(row.itemCount ?? 0),
        notes: row.notes ?? "",
        spaceType: readSpaceType(row.spaceType ?? row.space_type),
        style: row.style ?? null,
        version: Number(row.version ?? 1),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al clonar el paquete";
      return err(new DomainError("package.persistence_error", message, { cause }));
    }
  }
}
