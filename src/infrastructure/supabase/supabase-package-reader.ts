import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { calcularDiagnosticoEspacial } from "../../modules/packages/domain/spatial-diagnostic";
import { isTipoEspacio, type TipoEspacio } from "../../modules/packages/domain/space-type";
import type {
  PackageDetail,
  PackageItemSummary,
  PackageListReader,
  PackageReader,
  PackageSummary,
} from "../../modules/packages/application/ports/package-reader.port";

interface PackageRow {
  id: string;
  user_id: string;
  name: string | null;
  space_type: TipoEspacio | null;
  capacity_m2: number | string | null;
  client_name: string | null;
  event_date: string | null;
  venue: string | null;
  event_type: string | null;
  version: number;
}

interface PackageItemJoinedRow {
  id: string;
  module_id: string;
  catalog_modules: { area_m2: number | string } | { area_m2: number | string }[] | null;
}

interface PackageSummaryRow {
  id: string;
  name: string | null;
  space_type: unknown;
  capacity_m2: number | string | null;
  client_name: string | null;
  event_date: string | null;
  venue: string | null;
  event_type: string | null;
  updated_at: string;
  package_items: PackageItemJoinedRow[] | null;
}

/** Postgres `invalid_text_representation`: a malformed uuid reached the query. */
const INVALID_TEXT_REPRESENTATION = "22P02";

const readArea = (join: PackageItemJoinedRow["catalog_modules"]): number => {
  const area = Array.isArray(join) ? join[0]?.area_m2 : join?.area_m2;
  return Number(area ?? 0);
};

export class SupabasePackageReader implements PackageReader, PackageListReader {
  constructor(private readonly client: SupabaseClient) {}

  async listByOwner(userId: string): Promise<Result<readonly PackageSummary[], DomainError>> {
    try {
      const { data, error } = await this.client
        .from("packages")
        .select(
          "id, name, space_type, capacity_m2, client_name, event_date, venue, event_type, updated_at, package_items(catalog_modules(area_m2))",
        )
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        return err(new DomainError("package.persistence_error", error.message, { cause: error }));
      }

      return ok(
        ((data as PackageSummaryRow[] | null) ?? []).map((row) => {
          const capacityM2 = row.capacity_m2 === null ? null : Number(row.capacity_m2);
          const requiredM2 = ((row.package_items as PackageItemJoinedRow[] | null) ?? []).reduce(
            (total, item) => total + readArea(item.catalog_modules),
            0,
          );
          const diagnostico = calcularDiagnosticoEspacial(capacityM2, requiredM2);

          return {
            capacityM2,
            clientName: row.client_name ?? null,
            eventDate: row.event_date ?? null,
            eventType: row.event_type ?? null,
            id: row.id,
            name: row.name ?? "",
            spaceType: isTipoEspacio(row.space_type) ? row.space_type : null,
            spatial: {
              availableM2: diagnostico.areaDisponibleM2,
              requiredM2: diagnostico.areaRequeridaM2,
              status: diagnostico.estado,
            },
            updatedAt: row.updated_at,
            venue: row.venue ?? null,
          };
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error al consultar paquetes";
      return err(new DomainError("package.persistence_error", message, { cause }));
    }
  }

  async getPackage(packageId: string, userId: string): Promise<Result<PackageDetail | null, DomainError>> {
    try {
      const { data: pkgData, error: pkgError } = await this.client
        .from("packages")
        .select(
          "id, user_id, name, space_type, capacity_m2, client_name, event_date, venue, event_type, version",
        )
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

      const items: PackageItemSummary[] = ((itemsData as unknown as PackageItemJoinedRow[]) ?? []).map((row) => ({
        areaM2: readArea(row.catalog_modules),
        itemId: row.id,
        moduleId: row.module_id,
      }));

      return ok({
        capacityM2: pkg.capacity_m2 === null ? null : Number(pkg.capacity_m2),
        clientName: pkg.client_name ?? null,
        eventDate: pkg.event_date ?? null,
        eventType: pkg.event_type ?? null,
        id: pkg.id,
        items,
        name: pkg.name ?? "",
        spaceType: isTipoEspacio(pkg.space_type) ? pkg.space_type : null,
        userId: pkg.user_id,
        venue: pkg.venue ?? null,
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
        if (error.code === INVALID_TEXT_REPRESENTATION) {
          return ok(null);
        }
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
