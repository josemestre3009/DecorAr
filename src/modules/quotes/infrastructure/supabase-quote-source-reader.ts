import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { QuoteLineSnapshot } from "../domain/quote";
import type { QuoteSource, QuoteSourceReader } from "../application/ports/quote-source-reader.port";

type CatalogModuleRow = { name: string; price_cop: number | string };
type PackageRow = { id: string; version: number };
// PostgREST returns a to-one embedded relation as an array or an object.
type ItemRow = {
  module_id: string;
  catalog_modules: CatalogModuleRow[] | CatalogModuleRow | null;
};

/** Postgres `invalid_text_representation`: a malformed uuid reached the query. */
const INVALID_TEXT_REPRESENTATION = "22P02";

const persistenceError = (message: string, cause: unknown) =>
  err(new DomainError("quote.persistence_error", message, { cause }));

function moduleOf(row: ItemRow): CatalogModuleRow | null {
  const relation = row.catalog_modules;
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

/**
 * Agrupa las filas de `package_items` (una por unidad) en conceptos por
 * módulo. El orden es determinista (nombre y luego id) para que la posición
 * de cada línea sea estable.
 */
export function groupItems(rows: readonly ItemRow[]): Result<QuoteLineSnapshot[], DomainError> {
  const byModule = new Map<string, QuoteLineSnapshot>();

  for (const row of rows) {
    const catalog = moduleOf(row);
    if (!catalog) {
      return persistenceError(`El módulo ${row.module_id} no tiene datos de catálogo`, row);
    }

    const current = byModule.get(row.module_id);
    byModule.set(row.module_id, {
      moduleId: row.module_id,
      name: catalog.name,
      quantity: (current?.quantity ?? 0) + 1,
      unitPriceCop: Number(catalog.price_cop),
    });
  }

  return ok(
    [...byModule.values()].sort(
      (a, b) => a.name.localeCompare(b.name, "es") || a.moduleId.localeCompare(b.moduleId),
    ),
  );
}

/**
 * Instantánea del evento para cotizar (DECOR-50). Se construye con el cliente
 * service_role, como el lector de presupuesto: la política de
 * `catalog_modules` solo expone módulos activos y un paquete puede contener
 * versiones ya reemplazadas. El dueño se filtra explicitamente por `user_id`
 * (el controlador ya autorizó el paquete) y el RPC lo vuelve a comprobar.
 */
export class SupabaseQuoteSourceReader implements QuoteSourceReader {
  constructor(private readonly client: SupabaseClient) {}

  async read(packageId: string, ownerId: string): Promise<Result<QuoteSource | null, DomainError>> {
    try {
      const { data: pkg, error: pkgError } = await this.client
        .from("packages")
        .select("id, version")
        .eq("id", packageId)
        .eq("user_id", ownerId)
        .maybeSingle<PackageRow>();

      if (pkgError) {
        if (pkgError.code === INVALID_TEXT_REPRESENTATION) return ok(null);
        return persistenceError(pkgError.message, pkgError);
      }
      if (!pkg) return ok(null);

      const { data: items, error: itemsError } = await this.client
        .from("package_items")
        .select("module_id, catalog_modules(name, price_cop)")
        .eq("package_id", packageId);

      if (itemsError) return persistenceError(itemsError.message, itemsError);

      const lines = groupItems((items ?? []) as unknown as ItemRow[]);
      if (!lines.ok) return lines;

      return ok({ lines: lines.value, packageId: pkg.id, packageVersion: pkg.version });
    } catch (cause) {
      return persistenceError(cause instanceof Error ? cause.message : "Error al leer el evento", cause);
    }
  }
}
