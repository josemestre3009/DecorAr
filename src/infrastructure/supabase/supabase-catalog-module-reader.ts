import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type {
  CatalogModuleReader,
  CatalogModuleSummary,
} from "../../modules/packages/application/ports/catalog-module-reader.port";

interface ModuleRow {
  id: string;
  name: string;
  area_m2: number | string;
  price_cop: number | string;
}

/** Postgres `invalid_text_representation`: a malformed uuid reached the query. */
const INVALID_TEXT_REPRESENTATION = "22P02";

export class SupabaseCatalogModuleReader implements CatalogModuleReader {
  constructor(private readonly client: SupabaseClient) {}

  async getModuleById(moduleId: string): Promise<Result<CatalogModuleSummary | null, DomainError>> {
    try {
      const { data, error } = await this.client
        .from("catalog_modules")
        .select("id, name, area_m2, price_cop")
        .eq("id", moduleId)
        .eq("status", "active")
        .maybeSingle();

      if (error) {
        if (error.code === INVALID_TEXT_REPRESENTATION) {
          return ok(null);
        }
        return err(new DomainError("catalog.persistence_error", error.message, { cause: error }));
      }

      if (!data) {
        return ok(null);
      }

      const row = data as ModuleRow;
      return ok({
        areaM2: Number(row.area_m2),
        id: row.id,
        name: row.name,
        priceCop: Number(row.price_cop),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error al consultar módulo del catálogo";
      return err(new DomainError("catalog.persistence_error", message, { cause }));
    }
  }
}
