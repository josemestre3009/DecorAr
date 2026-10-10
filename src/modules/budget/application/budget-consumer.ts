import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { BudgetState } from "../domain/budget-state";

export type ProcessBudgetEventInput = {
  readonly consumer: string;
  readonly eventId: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly totalCop: number;
};

export type ProcessBudgetEventOutcome = {
  /** `false` for a repeated `eventId` or a `packageVersion` that is not newer. */
  readonly applied: boolean;
  readonly budget: BudgetState;
};

/**
 * Wraps the atomic PostgreSQL function `process_budget_event`. Inserts the
 * processed-event record and conditionally upserts `budgets` in one
 * transaction: a repeated `eventId` short-circuits before touching `budgets`,
 * and a `packageVersion` that is not strictly greater than the stored one
 * leaves `budgets` untouched even though the event is recorded as processed.
 */
export interface BudgetConsumer {
  process(input: ProcessBudgetEventInput): Promise<Result<ProcessBudgetEventOutcome, DomainError>>;
}
