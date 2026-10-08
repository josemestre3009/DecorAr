import { describe, expect, it, vi } from "vitest";

import { packageModuleAddedExample, packageModuleRemovedExample } from "../../events/domain/event-examples";
import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok } from "../../../shared/domain/result";
import type { BudgetState } from "../domain/budget-state";
import type { PackageSnapshot } from "../domain/calculate-budget";
import { BUDGET_CONSUMER, ConsumePackageChangedEvent } from "./consume-package-changed-event.use-case";
import type { BudgetConsumer, ProcessBudgetEventOutcome } from "./budget-consumer";
import type { PackageSnapshotReader } from "./package-snapshot-reader";

const SNAPSHOT: PackageSnapshot = {
  packageId: packageModuleAddedExample.packageId,
  packageVersion: 3,
  nodes: [{ kind: "leaf", priceCop: 250000 }, { kind: "leaf", priceCop: 200000 }],
};

const BUDGET: BudgetState = {
  packageId: packageModuleAddedExample.packageId,
  totalCop: 450000,
  currency: "COP",
  packageVersion: 3,
  updatedAt: "2026-10-08T00:00:00.000Z",
};

function harness(outcome: ProcessBudgetEventOutcome) {
  const reader: PackageSnapshotReader = { read: vi.fn(async () => ok(SNAPSHOT)) };
  const consumer: BudgetConsumer = { process: vi.fn(async () => ok(outcome)) };
  const publisher = { publish: vi.fn(async () => undefined) };
  const ids = { generate: vi.fn(() => "generated-event-id") };
  const clock = { now: vi.fn(() => new Date("2026-10-08T00:00:00.000Z")) };

  return {
    reader,
    consumer,
    publisher,
    ids,
    clock,
    useCase: new ConsumePackageChangedEvent(reader, consumer, publisher, ids, clock),
  };
}

describe("ConsumePackageChangedEvent", () => {
  it("relee el paquete, calcula el total y persiste con packageVersion fuente", async () => {
    const { reader, consumer, useCase } = harness({ applied: true, budget: BUDGET });

    const result = await useCase.execute(packageModuleAddedExample);

    expect(reader.read).toHaveBeenCalledWith(packageModuleAddedExample.packageId);
    expect(consumer.process).toHaveBeenCalledWith({
      consumer: BUDGET_CONSUMER,
      eventId: packageModuleAddedExample.eventId,
      packageId: packageModuleAddedExample.packageId,
      packageVersion: SNAPSHOT.packageVersion,
      totalCop: 450000,
    });
    expect(result).toEqual(ok(BUDGET));
  });

  it("publica budget.recalculated sólo cuando applied es true", async () => {
    const { publisher, useCase } = harness({ applied: true, budget: BUDGET });

    await useCase.execute(packageModuleAddedExample);

    expect(publisher.publish).toHaveBeenCalledWith({
      eventId: "generated-event-id",
      type: "budget.recalculated",
      schemaVersion: 1,
      occurredAt: "2026-10-08T00:00:00.000Z",
      userId: packageModuleAddedExample.userId,
      packageId: packageModuleAddedExample.packageId,
      payload: {
        budgetId: BUDGET.packageId,
        totalCop: BUDGET.totalCop,
        causationEventId: packageModuleAddedExample.eventId,
      },
    });
  });

  it("no publica nada cuando el evento es un duplicado (applied: false)", async () => {
    const { publisher, useCase } = harness({ applied: false, budget: BUDGET });

    const result = await useCase.execute(packageModuleAddedExample);

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(result).toEqual(ok(BUDGET));
  });

  it("no publica nada cuando la packageVersion es vieja (applied: false)", async () => {
    const { publisher, useCase } = harness({ applied: false, budget: { ...BUDGET, packageVersion: 2 } });

    await useCase.execute({ ...packageModuleAddedExample, packageId: SNAPSHOT.packageId });

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("acepta package.module.removed igual que package.module.added", async () => {
    const { consumer, useCase } = harness({ applied: true, budget: BUDGET });

    const result = await useCase.execute(packageModuleRemovedExample);

    expect(consumer.process).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: packageModuleRemovedExample.eventId }),
    );
    expect(result.ok).toBe(true);
  });

  it("rechaza un evento budget.recalculated: no es un cambio de paquete", async () => {
    const { reader, useCase } = harness({ applied: true, budget: BUDGET });

    const result = await useCase.execute({
      eventId: "evt-1",
      type: "budget.recalculated",
      schemaVersion: 1,
      occurredAt: "2026-10-08T00:00:00.000Z",
      userId: packageModuleAddedExample.userId,
      packageId: packageModuleAddedExample.packageId,
      payload: { budgetId: "b1", totalCop: 1, causationEventId: "evt-0" },
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("event.unsupported_type");
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("rechaza un evento inválido sin releer el paquete", async () => {
    const { reader, useCase } = harness({ applied: true, budget: BUDGET });

    const result = await useCase.execute({ ...packageModuleAddedExample, schemaVersion: 2 });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("event.unsupported_version");
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("propaga package.not_found cuando el paquete ya no existe", async () => {
    const reader: PackageSnapshotReader = { read: vi.fn(async () => ok(null)) };
    const consumer: BudgetConsumer = { process: vi.fn() };
    const publisher = { publish: vi.fn() };
    const useCase = new ConsumePackageChangedEvent(reader, consumer, publisher, { generate: () => "x" }, {
      now: () => new Date(),
    });

    const result = await useCase.execute(packageModuleAddedExample);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("package.not_found");
    expect(consumer.process).not.toHaveBeenCalled();
  });

  it("propaga un fallo de lectura del paquete sin llamar al consumer", async () => {
    const failure = new DomainError("package.persistence_error", "boom");
    const reader: PackageSnapshotReader = { read: vi.fn(async () => err(failure)) };
    const consumer: BudgetConsumer = { process: vi.fn() };
    const publisher = { publish: vi.fn() };
    const useCase = new ConsumePackageChangedEvent(reader, consumer, publisher, { generate: () => "x" }, {
      now: () => new Date(),
    });

    const result = await useCase.execute(packageModuleAddedExample);

    expect(result).toEqual(err(failure));
    expect(consumer.process).not.toHaveBeenCalled();
  });

  it("propaga un total inválido sin llamar al consumer", async () => {
    const reader: PackageSnapshotReader = {
      read: vi.fn(async () =>
        ok({
          packageId: SNAPSHOT.packageId,
          packageVersion: 1,
          nodes: [{ kind: "leaf" as const, priceCop: -1 }],
        }),
      ),
    };
    const consumer: BudgetConsumer = { process: vi.fn() };
    const publisher = { publish: vi.fn() };
    const useCase = new ConsumePackageChangedEvent(reader, consumer, publisher, { generate: () => "x" }, {
      now: () => new Date(),
    });

    const result = await useCase.execute(packageModuleAddedExample);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("budget.invalid_leaf_price");
    expect(consumer.process).not.toHaveBeenCalled();
  });

  it("propaga un fallo de la persistencia idempotente sin publicar", async () => {
    const failure = new DomainError("budget.persistence_error", "boom");
    const reader: PackageSnapshotReader = { read: vi.fn(async () => ok(SNAPSHOT)) };
    const consumer: BudgetConsumer = { process: vi.fn(async () => err(failure)) };
    const publisher = { publish: vi.fn(async () => undefined) };
    const useCase = new ConsumePackageChangedEvent(reader, consumer, publisher, { generate: () => "x" }, {
      now: () => new Date(),
    });

    const result = await useCase.execute(packageModuleAddedExample);

    expect(result).toEqual(err(failure));
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
