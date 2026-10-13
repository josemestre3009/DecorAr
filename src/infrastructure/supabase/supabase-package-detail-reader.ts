import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type {
  PackageDetailItemRecord,
  PackageDetailReader,
  PackageDetailRecord,
} from "../../modules/packages/application/ports/package-detail-reader.port";
import type { TipoEspacio } from "../../modules/packages/domain/space-type";

interface PackageRow {
  id: string;
  name: string | null;
  space_type: TipoEspacio | null;
  capacity_m2: number | string | null;
  client_name: string | null;
  event_date: string | null;
  venue: string | null;
  event_type: string | null;
  version: number;
}

type CatalogJoin = { name: string; price_cop: number | string; area_m2: number | string };

interface ItemRow {
  id: string;
  module_id: string;
  group_id: string | null;
  catalog_modules: CatalogJoin | CatalogJoin[] | null;
}

interface GroupRow {
  id: string;
  name: string;
  parent_group_id: string | null;
}

/** Postgres `invalid_text_representation`: a malformed uuid reached the query. */
const INVALID_TEXT_REPRESENTATION = "22P02";

const persistenceError = (cause: unknown, fallback: string): DomainError =>
  new DomainError(
    "package.persistence_error",
    typeof cause === "object" && cause !== null && "message" in cause
      ? String((cause as { message: unknown }).message)
      : fallback,
    { cause },
  );

/**
 * Server-only reader for the package configurator (DECOR-22). Built with the
 * service-role client, like the other package readers: the page checks
 * ownership with `AuthorizePackageAccessUseCase` first, and the package query
 * is filtered by `user_id` again here. Items carry the catalog name, price and
 * area of the module version they reference.
 */
export class SupabasePackageDetailReader implements PackageDetailReader {
  constructor(private readonly client: SupabaseClient) {}

  async getDetail(packageId: string, userId: string): Promise<Result<PackageDetailRecord | null, DomainError>> {
    try {
      const { data: pkgData, error: pkgError } = await this.client
        .from("packages")
        .select(
          "id, name, space_type, capacity_m2, client_name, event_date, venue, event_type, version",
        )
        .eq("id", packageId)
        .eq("user_id", userId)
        .maybeSingle();

      if (pkgError) {
        if (pkgError.code === INVALID_TEXT_REPRESENTATION) {
          return ok(null);
        }
        return err(persistenceError(pkgError, "Error al consultar el paquete"));
      }

      if (!pkgData) {
        return ok(null);
      }

      const { data: itemsData, error: itemsError } = await this.client
        .from("package_items")
        .select("id, module_id, group_id, catalog_modules(name, price_cop, area_m2)")
        .eq("package_id", packageId)
        .order("created_at", { ascending: true });

      if (itemsError) {
        return err(persistenceError(itemsError, "Error al consultar los elementos del paquete"));
      }

      const { data: groupsData, error: groupsError } = await this.client
        .from("package_groups")
        .select("id, name, parent_group_id")
        .eq("package_id", packageId)
        .order("created_at", { ascending: true });

      if (groupsError) {
        return err(persistenceError(groupsError, "Error al consultar los grupos del paquete"));
      }

      const pkg = pkgData as PackageRow;
      const items: PackageDetailItemRecord[] = ((itemsData as unknown as ItemRow[]) ?? []).map((row) => {
        const catalogModule = Array.isArray(row.catalog_modules) ? row.catalog_modules[0] : row.catalog_modules;

        return {
          areaM2: Number(catalogModule?.area_m2 ?? 0),
          groupId: row.group_id,
          itemId: row.id,
          moduleId: row.module_id,
          name: catalogModule?.name ?? "Módulo no disponible",
          priceCop: Number(catalogModule?.price_cop ?? 0),
        };
      });

      return ok({
        capacityM2: pkg.capacity_m2 === null ? null : Number(pkg.capacity_m2),
        clientName: pkg.client_name ?? null,
        eventDate: pkg.event_date ?? null,
        eventType: pkg.event_type ?? null,
        groups: ((groupsData as GroupRow[]) ?? []).map((row) => ({
          groupId: row.id,
          name: row.name,
          parentGroupId: row.parent_group_id,
        })),
        id: pkg.id,
        items,
        name: pkg.name ?? "",
        spaceType: pkg.space_type ?? null,
        venue: pkg.venue ?? null,
        version: pkg.version,
      });
    } catch (cause) {
      return err(persistenceError(cause, "Error inesperado al consultar el paquete"));
    }
  }
}
