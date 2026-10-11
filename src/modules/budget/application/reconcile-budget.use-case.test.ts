import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok } from "../../../shared/domain/result";
import type { BudgetState } from "../domain/budget-state";
import type { PackageSnapshot } from "../domain/calculate-budget";
import type { BudgetReconciler, ReconcileBudgetOutcome } from "./budget-reconciler";
import type { PackageSnapshotReader } from "./package-snapshot-reader";
import { ReconcileBudgetUseCase } from "./reconcile-budget.use-case";

const PACKAGE_ID = "2b7e1516-28ae-4d2a-abf7-158809cf4f3c";

const SNAPSHOT: PackageSnapshot = {
  nodes: [{ kind: "leaf", priceCop: 250000 }, { kind: "leaf", priceCop: 200000 }],
  packageId: PACKAGE_ID,
  packageVersion: 4,
};

const BUDGET: BudgetState = {
  currency: "COP",
  packageId: PACKAGE_ID,
  packageVersion: 4,
  totalCop: 450000,
  updatedAt: "2026-10-10T00:00:00.000Z",
};

function harness(outcome: ReconcileBudgetOutcome) {
  const reader: PackageSnapshotReader = { read: vi.fn(async () => ok(SNAPSHOT)) };
  const reconciler: BudgetReconciler = { reconcile: vi.fn(async () => ok(outcome)) };
  const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

  return { logger, reader, reconciler, useCase: new ReconcileBudgetUseCase(reader, reconciler, logger) };
}

describe("ReconcileBudgetUseCase", () => {
  it("rereads the package, recalculates and reconciles with the recalculated total", async () => {
    const { reader, reconciler, useCase } = harness({ budget: BUDGET, corrected: true });

    const result = await useCase.execute(PACKAGE_ID);

    expect(reader.read).toHaveBeenCalledWith(PACKAGE_ID);
    expect(reconciler.reconcile).toHaveBeenCalledWith({
      packageId: PACKAGE_ID,
      packageVersion: 4,
      totalCop: 450000,
    });
    expect(result).toEqual(ok(BUDGET));
  });

  it("logs a correction when the reconciler applied one", async () => {
    const { logger, useCase } = harness({ budget: BUDGET, corrected: true });

    await useCase.execute(PACKAGE_ID);

    expect(logger.info).toHaveBeenCalledWith(
      "budget reconciled with a correction",
      expect.objectContaining({ corrected: true, packageId: PACKAGE_ID }),
    );
  });

  it("reports corrected=false and does not treat it as an error on a second, already-correct reconciliation", async () => {
    const { useCase, logger } = harness({ budget: BUDGET, corrected: false });

    const result = await useCase.execute(PACKAGE_ID);

    expect(result).toEqual(ok(BUDGET));
    expect(logger.info).toHaveBeenCalledWith(
      "budget reconciled without changes",
      expect.objectContaining({ corrected: false }),
    );
  });

  it("propagates a package.not_found error when the package no longer exists", async () => {
    const reader: PackageSnapshotReader = { read: vi.fn(async () => ok(null)) };
    const reconciler: BudgetReconciler = { reconcile: vi.fn() };

    const result = await new ReconcileBudgetUseCase(reader, reconciler).execute(PACKAGE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.not_found");
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it("propagates a reader failure without calling the reconciler", async () => {
    const failure = new DomainError("package.persistence_error", "db down");
    const reader: PackageSnapshotReader = { read: vi.fn(async () => err(failure)) };
    const reconciler: BudgetReconciler = { reconcile: vi.fn() };

    const result = await new ReconcileBudgetUseCase(reader, reconciler).execute(PACKAGE_ID);

    expect(result).toEqual(err(failure));
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it("propagates a reconciler failure", async () => {
    const failure = new DomainError("budget.persistence_error", "db down");
    const reader: PackageSnapshotReader = { read: vi.fn(async () => ok(SNAPSHOT)) };
    const reconciler: BudgetReconciler = { reconcile: vi.fn(async () => err(failure)) };

    const result = await new ReconcileBudgetUseCase(reader, reconciler).execute(PACKAGE_ID);

    expect(result).toEqual(err(failure));
  });
});
