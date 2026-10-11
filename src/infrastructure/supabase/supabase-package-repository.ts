import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type { ClonedPackageDto, ClonePackageDto, CreatedPackageDto } from "../../modules/packages/application/dtos/package.dto";
import type { PackageRepository } from "../../modules/packages/application/ports/package-repository.port";
import type { TipoEspacio } from "../../modules/packages/domain/space-type";

const KNOWN_CODES = new Set([
  "package.invalid_user",
  "package.invalid_space_type",
  "package.invalid_capacity",
  "package.invalid_source",
  "package.not_found",
]);

type RpcPackageRow = {
  id: string;
  spaceType: TipoEspacio;
  capacityM2: number | string;
};

type RpcClonedPackageRow = {
  id: string;
  spaceType: TipoEspacio;
  capacityM2: number | string;
  style?: string | null;
  colors?: string[];
  notes?: string;
  version?: number;
  itemCount?: number;
};


export class SupabasePackageRepository implements PackageRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(params: {
    userId: string;
    spaceType: TipoEspacio;
    capacityM2: number;
  }): Promise<Result<CreatedPackageDto, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("create_package", {
        p_capacity_m2: params.capacityM2,
        p_space_type: params.spaceType,
        p_user_id: params.userId,
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

      const row = data as RpcPackageRow;
      return ok({
        capacityM2: Number(row.capacityM2),
        id: row.id,
        spaceType: row.spaceType,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al crear el paquete";
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
        capacityM2: Number(row.capacityM2),
        colors: Array.isArray(row.colors) ? row.colors : [],
        id: row.id,
        itemCount: Number(row.itemCount ?? 0),
        notes: row.notes ?? "",
        spaceType: row.spaceType,
        style: row.style ?? null,
        version: Number(row.version ?? 1),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error inesperado al clonar el paquete";
      return err(new DomainError("package.persistence_error", message, { cause }));
    }
  }
}

