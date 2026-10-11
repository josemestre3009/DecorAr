import { randomUUID, timingSafeEqual } from "node:crypto";

import type { Logger } from "../../shared/application/ports";
import type { ReconcileBudgetUseCase } from "../../modules/budget/application/reconcile-budget.use-case";
import type { RetryOutboxUseCase } from "../../modules/events/application/retry-outbox.use-case";
import type { OutboxStore } from "../../modules/events/application/outbox";

const BEARER_PREFIX = "Bearer ";

/**
 * Constant-time comparison of the bearer token against the configured
 * secret. Different lengths are rejected without calling `timingSafeEqual`
 * (which throws on a length mismatch), itself not a timing leak: an
 * attacker already learns nothing from a length check alone, and every
 * equal-length guess still costs the same constant time.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export type RecoveryControllerDeps = {
  readonly recoverySecret: string | null;
  readonly outbox: Pick<OutboxStore, "listUnresolved">;
  readonly retryOutbox: Pick<RetryOutboxUseCase, "execute">;
  readonly reconcileBudget: Pick<ReconcileBudgetUseCase, "execute">;
  readonly logger?: Logger;
};

/**
 * HTTP adapter for the recovery endpoint (DECOR-31). Protected by a bearer
 * secret instead of a user session: there is no admin role in this
 * application, and this is meant to be invoked by an operator or a cron,
 * neither of which holds a Supabase session cookie.
 */
export class RecoveryController {
  constructor(private readonly deps: RecoveryControllerDeps) {}

  async handleList(request: Request): Promise<Response> {
    const authorized = this.authorize(request);
    if (!authorized.ok) return authorized.response;

    try {
      const unresolved = await this.deps.outbox.listUnresolved(100);

      if (!unresolved.ok) {
        return this.internalError(unresolved.error.message);
      }

      return Response.json({ events: unresolved.value }, { status: 200 });
    } catch (cause) {
      return this.internalError(cause);
    }
  }

  /**
   * Authorizes before dispatching on `?action` (DECOR-31). Checking the
   * secret first keeps the documented contract for every request: `503`
   * when the secret is unconfigured, `401` when it is missing or wrong, and
   * `400` for an unknown action only once the caller is authorized.
   */
  async handlePost(request: Request): Promise<Response> {
    const authorized = this.authorize(request);
    if (!authorized.ok) return authorized.response;

    const action = new URL(request.url).searchParams.get("action");

    if (action === "retry") return this.handleRetry(request);
    if (action === "reconcile") return this.handleReconcile(request);

    return Response.json(
      {
        error: {
          code: "recovery.invalid_action",
          message: "El parámetro action debe ser 'retry' o 'reconcile'.",
        },
      },
      { status: 400 },
    );
  }

  async handleRetry(request: Request): Promise<Response> {
    const authorized = this.authorize(request);
    if (!authorized.ok) return authorized.response;

    try {
      const result = await this.deps.retryOutbox.execute();

      if (!result.ok) {
        return this.internalError(result.error.message);
      }

      return Response.json(result.value, { status: 200 });
    } catch (cause) {
      return this.internalError(cause);
    }
  }

  async handleReconcile(request: Request): Promise<Response> {
    const authorized = this.authorize(request);
    if (!authorized.ok) return authorized.response;

    try {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {
        body = null;
      }

      const explicitPackageId =
        typeof body === "object" && body !== null && "packageId" in body
          ? String((body as Record<string, unknown>).packageId)
          : null;

      const packageIds = explicitPackageId
        ? [explicitPackageId]
        : await this.failedPackageIds();

      const results = [];
      for (const packageId of packageIds) {
        const outcome = await this.deps.reconcileBudget.execute(packageId);
        results.push({
          budget: outcome.ok ? outcome.value : null,
          error: outcome.ok ? null : outcome.error.message,
          packageId,
        });
      }

      return Response.json({ reconciled: results }, { status: 200 });
    } catch (cause) {
      return this.internalError(cause);
    }
  }

  private async failedPackageIds(): Promise<readonly string[]> {
    const unresolved = await this.deps.outbox.listUnresolved(500);

    if (!unresolved.ok) return [];

    const failedIds = unresolved.value
      .filter((event) => event.status === "failed")
      .map((event) => event.packageId);

    return Array.from(new Set(failedIds));
  }

  private authorize(request: Request): { ok: true } | { ok: false; response: Response } {
    const { recoverySecret } = this.deps;

    if (!recoverySecret) {
      this.deps.logger?.error("recovery endpoint called without DECOR_RECOVERY_SECRET configured", {
        component: "recovery",
      });
      return {
        ok: false,
        response: Response.json(
          { error: { code: "recovery.not_configured", message: "Recuperación no disponible." } },
          { status: 503 },
        ),
      };
    }

    const header = request.headers.get("authorization") ?? "";

    if (!header.startsWith(BEARER_PREFIX) || !secretsMatch(header.slice(BEARER_PREFIX.length), recoverySecret)) {
      return {
        ok: false,
        response: Response.json(
          { error: { code: "auth.unauthorized", message: "Secreto inválido." } },
          { status: 401 },
        ),
      };
    }

    return { ok: true };
  }

  private internalError(cause: unknown): Response {
    const correlationId = randomUUID();
    this.deps.logger?.error("recovery endpoint unexpected failure", {
      component: "recovery",
      correlationId,
      error: cause instanceof Error ? cause.message : String(cause),
    });

    return Response.json(
      { correlationId, error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { status: 500 },
    );
  }
}
