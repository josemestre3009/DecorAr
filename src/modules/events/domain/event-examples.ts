import type {
  BudgetRecalculatedEvent,
  PackageModuleAddedEvent,
  PackageModuleRemovedEvent,
} from "./event-contracts";

export const packageModuleAddedExample: PackageModuleAddedEvent = {
  eventId: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  type: "package.module.added",
  schemaVersion: 1,
  occurredAt: "2026-10-02T15:04:05.000Z",
  userId: "c90e45b6-e1d4-4b1d-aa61-f0337f18dc95",
  packageId: "2b7e1516-28ae-4d2a-abf7-158809cf4f3c",
  payload: {
    itemId: "8e4f2c1a-9d3b-4a6e-b7c5-1f2e3d4c5b6a",
    moduleId: "arco-floral",
  },
};

export const packageModuleRemovedExample: PackageModuleRemovedEvent = {
  ...packageModuleAddedExample,
  eventId: "7a2d3b8f-4c5e-4f60-9bac-1d2e3f4a5b6c",
  type: "package.module.removed",
  occurredAt: "2026-10-02T15:06:00.000Z",
};

export const budgetRecalculatedExample: BudgetRecalculatedEvent = {
  eventId: "9c4e5d0a-6e7f-4a81-bdce-3f4a5b6c7d8e",
  type: "budget.recalculated",
  schemaVersion: 1,
  occurredAt: "2026-10-02T15:04:06.000Z",
  userId: packageModuleAddedExample.userId,
  packageId: packageModuleAddedExample.packageId,
  payload: {
    budgetId: "4d5e6f70-8192-4a3b-8c4d-5e6f708192a3",
    totalCop: 1250000,
    causationEventId: packageModuleAddedExample.eventId,
  },
};
