import type { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { parseDomainEvent } from "../domain/event-contracts";
import type { EventPublisher } from "./event-publisher";
import type { OutboxStore } from "./outbox";

export type DrainOutboxSummary = {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
};

const DEFAULT_LIMIT = 50;
const MAX_REASON_LENGTH = 500;

const describeFailure = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause);

  return message.slice(0, MAX_REASON_LENGTH) || "unknown error";
};

/**
 * Initial delivery attempt only: publish after commit, mark `published` only on
 * success, otherwise leave the event pending with its error. Retries belong to
 * DECOR-31. Delivery is at-least-once; consumers deduplicate by `eventId`.
 */
export class DrainOutboxUseCase {
  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(limit = DEFAULT_LIMIT): Promise<Result<DrainOutboxSummary, DomainError>> {
    const claimed = await this.store.claimInitial(limit);

    if (!claimed.ok) {
      return err(claimed.error);
    }

    let published = 0;
    let failed = 0;

    for (const { eventId, event } of claimed.value) {
      const parsed = parseDomainEvent(event);

      if (!parsed.ok) {
        failed += 1;
        await this.store.recordFailure(eventId, parsed.error.message);
        continue;
      }

      try {
        await this.publisher.publish(parsed.value);
      } catch (cause) {
        failed += 1;
        await this.store.recordFailure(eventId, describeFailure(cause));
        continue;
      }

      const marked = await this.store.markPublished(eventId);

      if (marked.ok) {
        published += 1;
      } else {
        // Published but not marked: stays pending and DECOR-31 republishes it.
        failed += 1;
      }
    }

    return ok({ claimed: claimed.value.length, failed, published });
  }
}
