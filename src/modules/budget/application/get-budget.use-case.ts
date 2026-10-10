import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { BudgetState } from "../domain/budget-state";

/** Reads the confirmed budget for the GET resync endpoint. */
export interface BudgetReader {
  findByPackage(packageId: string): Promise<Result<BudgetState | null, DomainError>>;
}

/**
 * Resync path (DECOR-21 calls it on gap/reconnect/online/visibilitychange):
 * returns the persisted budget so a client that missed a Broadcast message
 * catches up from the database, the source of truth.
 */
export class GetBudgetUseCase {
  constructor(private readonly reader: BudgetReader) {}

  async execute(packageId: string): Promise<Result<BudgetState, DomainError>> {
    const budget = await this.reader.findByPackage(packageId);

    if (!budget.ok) {
      return err(budget.error);
    }

    if (budget.value === null) {
      return err(new DomainError("budget.not_found", "Este paquete todavía no tiene un presupuesto calculado."));
    }

    return ok(budget.value);
  }
}
