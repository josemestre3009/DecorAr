import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { BudgetState } from "../domain/budget-state";

export type ReconcileBudgetInput = {
  readonly packageId: string;
  readonly packageVersion: number;
  readonly totalCop: number;
};

export type ReconcileBudgetOutcome = {
  /** `false` when the stored budget already matched the recalculated one. */
  readonly corrected: boolean;
  readonly budget: BudgetState;
};

/**
 * Wraps the atomic PostgreSQL function `reconcile_budget` (DECOR-31).
 * Unlike `BudgetConsumer.process` (DECOR-33), which only moves forward on a
 * strictly newer `packageVersion`, this also corrects a stored total that
 * drifted for the *same* version, which is what a lost or exhausted
 * `budget.recalculated` can leave behind. A second call with an
 * already-correct value reports `corrected: false`.
 */
export interface BudgetReconciler {
  reconcile(input: ReconcileBudgetInput): Promise<Result<ReconcileBudgetOutcome, DomainError>>;
}
