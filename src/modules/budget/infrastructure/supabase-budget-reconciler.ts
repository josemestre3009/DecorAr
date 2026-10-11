import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type {
  BudgetReconciler,
  ReconcileBudgetInput,
  ReconcileBudgetOutcome,
} from "../application/budget-reconciler";

type RpcRow = {
  corrected: boolean;
  package_id: string;
  total_cop: number;
  package_version: number;
  updated_at: string;
};

const KNOWN_CODES = new Set(["package.invalid_version", "budget.invalid_total"]);

const persistenceError = (cause: unknown): DomainError =>
  new DomainError(
    "budget.persistence_error",
    cause instanceof Error || (typeof cause === "object" && cause !== null && "message" in cause)
      ? String((cause as { message: unknown }).message)
      : "Unexpected budget reconciler failure",
    { cause },
  );

/**
 * Server-only adapter over `reconcile_budget` (DECOR-31). Must be built
 * with the service-role client: `budgets` denies direct writes from
 * anon/authenticated.
 */
export class SupabaseBudgetReconciler implements BudgetReconciler {
  constructor(private readonly client: SupabaseClient) {}

  async reconcile(input: ReconcileBudgetInput): Promise<Result<ReconcileBudgetOutcome, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("reconcile_budget", {
        p_package_id: input.packageId,
        p_package_version: input.packageVersion,
        p_total_cop: input.totalCop,
      });

      if (error) {
        const message = error.message;
        return err(
          KNOWN_CODES.has(message)
            ? new DomainError(message, message, { cause: error })
            : persistenceError(error),
        );
      }

      const rows = (data ?? []) as RpcRow[];
      const row = rows[0];

      if (!row) {
        return err(persistenceError(new Error("reconcile_budget returned no row")));
      }

      return ok({
        budget: {
          currency: "COP",
          packageId: row.package_id,
          packageVersion: row.package_version,
          totalCop: row.total_cop,
          updatedAt: row.updated_at,
        },
        corrected: row.corrected,
      });
    } catch (cause) {
      return err(persistenceError(cause));
    }
  }
}
