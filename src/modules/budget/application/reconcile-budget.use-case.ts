import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Logger } from "../../../shared/application/ports";
import { calculateBudget } from "../domain/calculate-budget";
import type { BudgetState } from "../domain/budget-state";
import type { BudgetReconciler } from "./budget-reconciler";
import type { PackageSnapshotReader } from "./package-snapshot-reader";

/**
 * Rereads a package, recalculates its budget with the same pure Composite
 * sum DECOR-33 uses (`calculateBudget`), and corrects the stored budget only
 * if it drifted (DECOR-31). Deliberately independent of any particular
 * event: reconciliation's whole point is to recover from the source of
 * truth (the persisted package) when an event-driven path never completed.
 */
export class ReconcileBudgetUseCase {
  constructor(
    private readonly reader: PackageSnapshotReader,
    private readonly reconciler: BudgetReconciler,
    private readonly logger?: Logger,
  ) {}

  async execute(packageId: string): Promise<Result<BudgetState, DomainError>> {
    const snapshot = await this.reader.read(packageId);

    if (!snapshot.ok) {
      return err(snapshot.error);
    }

    if (snapshot.value === null) {
      return err(new DomainError("package.not_found", "No encontramos este paquete."));
    }

    const total = calculateBudget(snapshot.value);

    if (!total.ok) {
      return err(total.error);
    }

    const outcome = await this.reconciler.reconcile({
      packageId,
      packageVersion: snapshot.value.packageVersion,
      totalCop: total.value,
    });

    if (!outcome.ok) {
      return err(outcome.error);
    }

    this.logger?.info(outcome.value.corrected ? "budget reconciled with a correction" : "budget reconciled without changes", {
      component: "budget.reconcile",
      corrected: outcome.value.corrected,
      packageId,
      packageVersion: snapshot.value.packageVersion,
    });

    return ok(outcome.value.budget);
  }
}
