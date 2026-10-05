import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { CatalogModule, type CatalogModuleStatus } from "../domain/catalog-module";
import { type CatalogRepository } from "../application/ports/catalog-repository.port";

export interface CatalogModuleRow {
  id: string;
  asset_id: string;
  version: number;
  name: string;
  price_cop: number;
  area_m2: number | string;
  width_m: number | string | null;
  height_m: number | string | null;
  depth_m: number | string | null;
  glb_url: string | null;
  usdz_url: string | null;
  poster_url: string | null;
  status: CatalogModuleStatus;
}

export class SupabaseCatalogRepository implements CatalogRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getActiveModules(): Promise<Result<CatalogModule[], DomainError>> {
    try {
      const { data, error } = await this.client
        .from("catalog_modules")
        .select(
          "id, asset_id, version, name, price_cop, area_m2, width_m, height_m, depth_m, glb_url, usdz_url, poster_url, status",
        )
        .eq("status", "active")
        .order("name", { ascending: true });

      if (error) {
        return err(
          new DomainError("catalog.persistence_error", error.message, {
            cause: error,
          }),
        );
      }

      const rows = (data ?? []) as CatalogModuleRow[];
      const modules: CatalogModule[] = [];

      for (const row of rows) {
        const moduleResult = CatalogModule.create({
          id: row.id,
          assetId: row.asset_id,
          version: row.version,
          name: row.name,
          priceCop: Number(row.price_cop),
          areaM2: Number(row.area_m2),
          widthM: row.width_m !== null ? Number(row.width_m) : null,
          heightM: row.height_m !== null ? Number(row.height_m) : null,
          depthM: row.depth_m !== null ? Number(row.depth_m) : null,
          glbUrl: row.glb_url,
          usdzUrl: row.usdz_url,
          posterUrl: row.poster_url,
          status: row.status,
        });

        if (!moduleResult.ok) {
          return err(moduleResult.error);
        }

        modules.push(moduleResult.value);
      }

      return ok(modules);
    } catch (unexpectedError) {
      return err(
        new DomainError(
          "catalog.unexpected_error",
          unexpectedError instanceof Error ? unexpectedError.message : "Unexpected failure in catalog repository",
          { cause: unexpectedError },
        ),
      );
    }
  }
}
