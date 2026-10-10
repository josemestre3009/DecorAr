import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { BudgetState } from "../domain/budget-state";
import type { BudgetReader } from "../application/get-budget.use-case";

type BudgetRow = {
  package_id: string;
  total_cop: number;
  package_version: number;
  updated_at: string;
};

/**
 * Built with the session client, so RLS also filters the read to the owner
 * (DECOR-33's `budgets` policy mirrors DECOR-30's for `packages`). Used by
 * the GET resync Route Handler after `checkPackageAccess` already confirmed
 * ownership.
 */
export function createSupabaseBudgetReader(client: SupabaseClient): BudgetReader {
  return {
    async findByPackage(packageId: string): Promise<Result<BudgetState | null, DomainError>> {
      const { data, error } = await client
        .from("budgets")
        .select("package_id, total_cop, package_version, updated_at")
        .eq("package_id", packageId)
        .maybeSingle<BudgetRow>();

      if (error) {
        return err(new DomainError("budget.persistence_error", error.message, { cause: error }));
      }

      if (!data) {
        return ok(null);
      }

      return ok({
        packageId: data.package_id,
        totalCop: data.total_cop,
        currency: "COP",
        packageVersion: data.package_version,
        updatedAt: data.updated_at,
      });
    },
  };
}
