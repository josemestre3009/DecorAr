import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type { CreatedPackageDto } from "../../modules/packages/application/dtos/package.dto";
import type { PackageRepository } from "../../modules/packages/application/ports/package-repository.port";
import type { TipoEspacio } from "../../modules/packages/domain/space-type";

const KNOWN_CODES = new Set([
  "package.invalid_user",
  "package.invalid_space_type",
  "package.invalid_capacity",
]);

type RpcPackageRow = {
  id: string;
  spaceType: TipoEspacio;
  capacityM2: number | string;
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
}
