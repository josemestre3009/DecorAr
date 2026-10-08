import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type {
  BudgetConsumer,
  ProcessBudgetEventInput,
  ProcessBudgetEventOutcome,
} from "../application/budget-consumer";

type RpcRow = {
  applied: boolean;
  package_id: string;
  total_cop: number;
  package_version: number;
  updated_at: string;
};

const KNOWN_CODES = new Set([
  "budget.invalid_consumer",
  "budget.invalid_total",
  "event.invalid",
  "package.invalid_version",
]);

const persistenceError = (cause: unknown): DomainError =>
  new DomainError(
    "budget.persistence_error",
    cause instanceof Error || (typeof cause === "object" && cause !== null && "message" in cause)
      ? String((cause as { message: unknown }).message)
      : "Unexpected budget consumer failure",
    { cause },
  );

/**
 * Server-only adapter over `process_budget_event`. Must be built with the
 * service-role client: `budgets` and `processed_events` deny direct writes
 * from anon/authenticated.
 */
export class SupabaseBudgetConsumer implements BudgetConsumer {
  constructor(private readonly client: SupabaseClient) {}

  async process(input: ProcessBudgetEventInput): Promise<Result<ProcessBudgetEventOutcome, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("process_budget_event", {
        p_consumer: input.consumer,
        p_event_id: input.eventId,
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
        return err(persistenceError(new Error("process_budget_event returned no row")));
      }

      return ok({
        applied: row.applied,
        budget: {
          packageId: row.package_id,
          totalCop: row.total_cop,
          currency: "COP",
          packageVersion: row.package_version,
          updatedAt: row.updated_at,
        },
      });
    } catch (cause) {
      return err(persistenceError(cause));
    }
  }
}
