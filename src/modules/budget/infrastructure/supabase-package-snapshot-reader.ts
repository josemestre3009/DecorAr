import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { BudgetNode, PackageSnapshot } from "../domain/calculate-budget";
import type { PackageSnapshotReader } from "../application/package-snapshot-reader";

type CatalogModulePrice = { price_cop: number };
type PackageRow = { version: number };
// PostgREST returns a to-one embedded relation as an array even though the
// foreign key makes it at most one row; this mirrors that wire shape.
type ItemRow = { catalog_modules: CatalogModulePrice[] | CatalogModulePrice | null };

function priceOf(row: ItemRow): number {
  const relation = row.catalog_modules;

  if (relation === null) {
    return 0;
  }

  const single: CatalogModulePrice | undefined = Array.isArray(relation) ? relation[0] : relation;

  return Number(single?.price_cop ?? 0);
}

/**
 * Server-only adapter, built with the service-role client so the reread is
 * never blocked by the RLS policy that scopes reads to the owner: by the
 * time this runs, the caller has already authorized the request through
 * `checkPackageAccess` or the consumer's own trust boundary (DECOR-27 invokes
 * this right after committing the package change on behalf of the session
 * user). `package_items` has no group structure yet (DECOR-25 adds it), so
 * every item is read as a flat leaf; `calculateBudget` already supports
 * nesting once groups exist.
 */
export function createSupabasePackageSnapshotReader(client: SupabaseClient): PackageSnapshotReader {
  return {
    async read(packageId: string): Promise<Result<PackageSnapshot | null, DomainError>> {
      try {
        const { data: pkg, error: pkgError } = await client
          .from("packages")
          .select("version")
          .eq("id", packageId)
          .maybeSingle<PackageRow>();

        if (pkgError) {
          return err(new DomainError("package.persistence_error", pkgError.message, { cause: pkgError }));
        }

        if (!pkg) {
          return ok(null);
        }

        const { data: items, error: itemsError } = await client
          .from("package_items")
          .select("catalog_modules(price_cop)")
          .eq("package_id", packageId);

        if (itemsError) {
          return err(new DomainError("package.persistence_error", itemsError.message, { cause: itemsError }));
        }

        const nodes: BudgetNode[] = ((items ?? []) as unknown as ItemRow[]).map((row) => ({
          kind: "leaf",
          priceCop: priceOf(row),
        }));

        return ok({ packageId, packageVersion: pkg.version, nodes });
      } catch (unexpectedError) {
        return err(
          new DomainError(
            "package.unexpected_error",
            unexpectedError instanceof Error
              ? unexpectedError.message
              : "Unexpected failure reading package snapshot",
            { cause: unexpectedError },
          ),
        );
      }
    },
  };
}
