/** Confirmed budget for a package, as persisted by `process_budget_event`. */
export type BudgetState = {
  readonly packageId: string;
  readonly totalCop: number;
  readonly currency: "COP";
  readonly packageVersion: number;
  /** ISO 8601 UTC. */
  readonly updatedAt: string;
};
