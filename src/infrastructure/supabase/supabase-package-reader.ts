import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type {
  PackageDetail,
  PackageItemSummary,
  PackageReader,
} from "../../modules/packages/application/ports/package-reader.port";
import type { TipoEspacio } from "../../modules/packages/domain/space-type";

interface PackageRow {
  id: string;
  user_id: string;
  space_type: TipoEspacio;
  capacity_m2: number | string;
  version: number;
}

interface PackageItemJoinedRow {
  id: string;
  module_id: string;
  catalog_modules: { area_m2: number | string } | { area_m2: number | string }[] | null;
}

export class SupabasePackageReader implements PackageReader {
  constructor(private readonly client: SupabaseClient) {}

  async getPackage(packageId: string, userId: string): Promise<Result<PackageDetail | null, DomainError>> {
    try {
      const { data: pkgData, error: pkgError } = await this.client
        .from("packages")
        .select("id, user_id, space_type, capacity_m2, version")
        .eq("id", packageId)
        .eq("user_id", userId)
        .maybeSingle();

      if (pkgError) {
        return err(new DomainError("package.persistence_error", pkgError.message, { cause: pkgError }));
      }

      if (!pkgData) {
        return ok(null);
      }

      const pkg = pkgData as PackageRow;

      const { data: itemsData, error: itemsError } = await this.client
        .from("package_items")
        .select("id, module_id, catalog_modules(area_m2)")
        .eq("package_id", packageId);

      if (itemsError) {
        return err(new DomainError("package.persistence_error", itemsError.message, { cause: itemsError }));
      }

      const items: PackageItemSummary[] = ((itemsData as unknown as PackageItemJoinedRow[]) ?? []).map((row) => {
        const area = Array.isArray(row.catalog_modules)
          ? row.catalog_modules[0]?.area_m2
          : row.catalog_modules?.area_m2;

        return {
          areaM2: Number(area ?? 0),
          itemId: row.id,
          moduleId: row.module_id,
        };
      });

      return ok({
        capacityM2: Number(pkg.capacity_m2),
        id: pkg.id,
        items,
        spaceType: pkg.space_type,
        userId: pkg.user_id,
        version: pkg.version,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error al consultar paquete";
      return err(new DomainError("package.persistence_error", message, { cause }));
    }
  }

  async getItemModuleId(packageId: string, itemId: string): Promise<Result<string | null, DomainError>> {
    try {
      const { data, error } = await this.client
        .from("package_items")
        .select("module_id")
        .eq("package_id", packageId)
        .eq("id", itemId)
        .maybeSingle();

      if (error) {
        return err(new DomainError("package.persistence_error", error.message, { cause: error }));
      }

      if (!data) {
        return ok(null);
      }

      return ok((data as { module_id: string }).module_id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error al consultar elemento de paquete";
      return err(new DomainError("package.persistence_error", message, { cause }));
    }
  }
}
