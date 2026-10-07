import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { CatalogModule } from "../domain/catalog-module";
import type {
  ActivateCatalogModuleParams,
  CatalogActivationPort,
} from "../application/ports/catalog-activation.port";
import type { CatalogModuleRow } from "./supabase-catalog-repository";

export class SupabaseCatalogActivationAdapter implements CatalogActivationPort {
  constructor(private readonly client: SupabaseClient) {}

  async activateModule(
    params: ActivateCatalogModuleParams,
  ): Promise<Result<CatalogModule, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("activate_catalog_module", {
        p_asset_id: params.assetId,
        p_version: params.version,
        p_glb_url: params.glbUrl,
        p_usdz_url: params.usdzUrl,
        p_poster_url: params.posterUrl,
        p_width_m: params.widthM,
        p_height_m: params.heightM,
        p_depth_m: params.depthM,
      });

      if (error) {
        return err(
          new DomainError("catalog.activation_error", error.message, {
            cause: error,
          }),
        );
      }

      if (!data) {
        return err(
          new DomainError(
            "catalog.activation_missing_data",
            "RPC activate_catalog_module returned no data",
          ),
        );
      }

      const row = data as CatalogModuleRow;

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

      return ok(moduleResult.value);
    } catch (unexpectedError) {
      const message =
        unexpectedError instanceof Error
          ? unexpectedError.message
          : "Unexpected failure in catalog activation";
      return err(
        new DomainError("catalog.unexpected_activation_error", message, {
          cause: unexpectedError,
        }),
      );
    }
  }
}
