import { err, ok, type Result } from "@/shared/domain/result";

import {
  networkFailure,
  readApiError,
  unexpectedResponseFailure,
  type ApiFailure,
} from "./api-error";

export type ConfirmedBudget = {
  readonly totalCop: number;
  readonly currency: "COP";
  readonly packageVersion: number;
  readonly updatedAt: string;
};

export interface BudgetClient {
  getBudget(packageId: string): Promise<Result<ConfirmedBudget, ApiFailure>>;
}

function isConfirmedBudget(value: unknown): value is ConfirmedBudget {
  if (typeof value !== "object" || value === null) return false;

  const body = value as Record<string, unknown>;

  return (
    typeof body.totalCop === "number" &&
    body.currency === "COP" &&
    typeof body.packageVersion === "number" &&
    typeof body.updatedAt === "string"
  );
}

export function createHttpBudgetClient(fetcher: typeof fetch = fetch): BudgetClient {
  return {
    async getBudget(packageId: string): Promise<Result<ConfirmedBudget, ApiFailure>> {
      const url = `/api/packages/${encodeURIComponent(packageId)}/budget`;
      let response: Response;

      try {
        response = await fetcher(url, {
          headers: { Accept: "application/json" },
          method: "GET",
        });
      } catch {
        return err(networkFailure());
      }

      if (response.status !== 200) {
        return err(
          response.ok ? unexpectedResponseFailure(response.status) : await readApiError(response),
        );
      }

      let body: unknown;

      try {
        body = await response.json();
      } catch {
        return err(unexpectedResponseFailure(response.status));
      }

      return isConfirmedBudget(body) ? ok(body) : err(unexpectedResponseFailure(response.status));
    },
  };
}
