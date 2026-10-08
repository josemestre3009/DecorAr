import type { Clock, IdGenerator } from "../../../shared/application/ports";
import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { EventPublisher } from "../../events/application/event-publisher";
import { parseDomainEvent, type PackageModuleAddedEvent, type PackageModuleRemovedEvent } from "../../events/domain/event-contracts";
import type { BudgetConsumer } from "./budget-consumer";
import { calculateBudget } from "../domain/calculate-budget";
import type { BudgetState } from "../domain/budget-state";
import type { PackageSnapshotReader } from "./package-snapshot-reader";

/** The only events that trigger a recalculation; `budget.recalculated` itself never does. */
export type PackageChangedEvent = PackageModuleAddedEvent | PackageModuleRemovedEvent;

export const BUDGET_CONSUMER = "budget";

/**
 * Consumes a `package.module.added`/`removed` event and recalculates the
 * package's budget. Rereads the package rather than trusting the event
 * payload (DECOR-29 keeps prices out of package events on purpose), then asks
 * `process_budget_event` to persist idempotently, and only publishes
 * `budget.recalculated` when that call actually applied a change.
 *
 * Deliberately not an `EventPublisher` subscriber: whoever commits the
 * package change (DECOR-27) invokes this directly with the same event, so
 * recalculation never depends on Realtime having delivered anything.
 */
export class ConsumePackageChangedEvent {
  constructor(
    private readonly reader: PackageSnapshotReader,
    private readonly consumer: BudgetConsumer,
    private readonly publisher: Pick<EventPublisher, "publish">,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(rawEvent: unknown): Promise<Result<BudgetState, DomainError>> {
    const parsed = parseDomainEvent(rawEvent);

    if (!parsed.ok) {
      return err(parsed.error);
    }

    if (parsed.value.type !== "package.module.added" && parsed.value.type !== "package.module.removed") {
      return err(
        new DomainError(
          "event.unsupported_type",
          `ConsumePackageChangedEvent sólo acepta package.module.added/removed, se recibió ${parsed.value.type}`,
        ),
      );
    }

    const event = parsed.value;

    const snapshot = await this.reader.read(event.packageId);

    if (!snapshot.ok) {
      return err(snapshot.error);
    }

    if (snapshot.value === null) {
      return err(new DomainError("package.not_found", "No encontramos este paquete."));
    }

    const total = calculateBudget(snapshot.value);

    if (!total.ok) {
      return err(total.error);
    }

    const outcome = await this.consumer.process({
      consumer: BUDGET_CONSUMER,
      eventId: event.eventId,
      packageId: event.packageId,
      packageVersion: snapshot.value.packageVersion,
      totalCop: total.value,
    });

    if (!outcome.ok) {
      return err(outcome.error);
    }

    if (outcome.value.applied) {
      await this.publisher.publish({
        eventId: this.ids.generate(),
        type: "budget.recalculated",
        schemaVersion: 1,
        occurredAt: this.clock.now().toISOString(),
        userId: event.userId,
        packageId: event.packageId,
        payload: {
          budgetId: outcome.value.budget.packageId,
          totalCop: outcome.value.budget.totalCop,
          causationEventId: event.eventId,
        },
      });
    }

    return ok(outcome.value.budget);
  }
}
