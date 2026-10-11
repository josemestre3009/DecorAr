import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type { BudgetState } from "../../modules/budget/domain/budget-state";
import type { UnresolvedOutboxEvent } from "../../modules/events/application/outbox";
import type { RetryOutboxSummary } from "../../modules/events/application/retry-outbox.use-case";
import { RecoveryController, type RecoveryControllerDeps } from "./recovery-controller";

const SECRET = "test-recovery-secret-value";

function harness(overrides: Partial<RecoveryControllerDeps> = {}) {
  const outbox = {
    listUnresolved: vi.fn<(limit: number) => Promise<Result<readonly UnresolvedOutboxEvent[], DomainError>>>(
      async () => ok([]),
    ),
  };
  const retryOutbox = {
    execute: vi.fn<() => Promise<Result<RetryOutboxSummary, DomainError>>>(async () =>
      ok({ exhausted: 0, failed: 0, published: 1, retried: 1 }),
    ),
  };
  const reconcileBudget = {
    execute: vi.fn<(packageId: string) => Promise<Result<BudgetState, DomainError>>>(async () =>
      ok({ currency: "COP", packageId: "pkg-1", packageVersion: 2, totalCop: 100, updatedAt: "now" }),
    ),
  };

  const controller = new RecoveryController({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    outbox,
    reconcileBudget,
    recoverySecret: SECRET,
    retryOutbox,
    ...overrides,
  });

  return { controller, outbox, reconcileBudget, retryOutbox };
}

function requestWith(auth?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://localhost/api/internal/recovery", { ...init, headers });
}

describe("RecoveryController", () => {
  it("responds 503 when the recovery secret is not configured, before checking anything else", async () => {
    const { controller, retryOutbox } = harness({ recoverySecret: null });

    const res = await controller.handleList(requestWith(`Bearer ${SECRET}`));

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("recovery.not_configured");
    expect(retryOutbox.execute).not.toHaveBeenCalled();
  });

  it("responds 401 when the Authorization header is missing", async () => {
    const { controller } = harness();

    const res = await controller.handleList(requestWith());

    expect(res.status).toBe(401);
  });

  it("responds 401 when the bearer secret does not match", async () => {
    const { controller } = harness();

    const res = await controller.handleList(requestWith("Bearer wrong-secret"));

    expect(res.status).toBe(401);
  });

  it("lists unresolved events when the secret matches", async () => {
    const { controller, outbox } = harness();
    outbox.listUnresolved.mockResolvedValue(
      ok([
        {
          attempts: 4,
          correlationId: null,
          eventId: "evt-1",
          lastError: "down",
          packageId: "pkg-1",
          status: "failed" as const,
        },
      ]),
    );

    const res = await controller.handleList(requestWith(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      events: [
        { attempts: 4, correlationId: null, eventId: "evt-1", lastError: "down", packageId: "pkg-1", status: "failed" },
      ],
    });
  });

  it("triggers the retry use case and returns its summary", async () => {
    const { controller, retryOutbox } = harness();

    const res = await controller.handleRetry(requestWith(`Bearer ${SECRET}`, { method: "POST" }));

    expect(res.status).toBe(200);
    expect(retryOutbox.execute).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ exhausted: 0, failed: 0, published: 1, retried: 1 });
  });

  it("reconciles an explicit packageId from the request body", async () => {
    const { controller, reconcileBudget } = harness();

    const res = await controller.handleReconcile(
      requestWith(`Bearer ${SECRET}`, { body: JSON.stringify({ packageId: "pkg-42" }), method: "POST" }),
    );

    expect(res.status).toBe(200);
    expect(reconcileBudget.execute).toHaveBeenCalledWith("pkg-42");
    const body = await res.json();
    expect(body.reconciled).toHaveLength(1);
    expect(body.reconciled[0].packageId).toBe("pkg-42");
  });

  it("reconciles every package with a failed event when no packageId is given", async () => {
    const { controller, outbox, reconcileBudget } = harness();
    outbox.listUnresolved.mockResolvedValue(
      ok([
        { attempts: 4, correlationId: null, eventId: "evt-1", lastError: "x", packageId: "pkg-a", status: "failed" as const },
        { attempts: 4, correlationId: null, eventId: "evt-2", lastError: "x", packageId: "pkg-a", status: "failed" as const },
        { attempts: 1, correlationId: null, eventId: "evt-3", lastError: null, packageId: "pkg-b", status: "pending" as const },
      ]),
    );

    const res = await controller.handleReconcile(requestWith(`Bearer ${SECRET}`, { method: "POST" }));

    expect(res.status).toBe(200);
    expect(reconcileBudget.execute).toHaveBeenCalledTimes(1);
    expect(reconcileBudget.execute).toHaveBeenCalledWith("pkg-a");
  });

  it("reports a reconciliation error per package without failing the whole request", async () => {
    const { controller, reconcileBudget } = harness();
    reconcileBudget.execute.mockResolvedValue(err(new DomainError("package.not_found", "no existe")));

    const res = await controller.handleReconcile(
      requestWith(`Bearer ${SECRET}`, { body: JSON.stringify({ packageId: "pkg-gone" }), method: "POST" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconciled[0]).toMatchObject({ budget: null, error: "no existe", packageId: "pkg-gone" });
  });

  it("maps a domain error from retry to a 500 with a correlationId", async () => {
    const { controller, retryOutbox } = harness();
    retryOutbox.execute.mockResolvedValue(err(new DomainError("outbox.persistence_error", "db down")));

    const res = await controller.handleRetry(requestWith(`Bearer ${SECRET}`, { method: "POST" }));

    expect(res.status).toBe(500);
    expect((await res.json()).correlationId).toBeTruthy();
  });

  it("maps an uncaught exception to a 500 with a correlationId", async () => {
    const { controller, retryOutbox } = harness();
    retryOutbox.execute.mockRejectedValue(new Error("boom"));

    const res = await controller.handleRetry(requestWith(`Bearer ${SECRET}`, { method: "POST" }));

    expect(res.status).toBe(500);
    expect((await res.json()).correlationId).toBeTruthy();
  });
});
