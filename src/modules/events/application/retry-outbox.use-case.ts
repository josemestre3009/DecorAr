import type { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Logger, Sleep } from "../../../shared/application/ports";
import { parseDomainEvent } from "../domain/event-contracts";
import type { EventPublisher } from "./event-publisher";
import type { OutboxStore } from "./outbox";

export type RetryOutboxSummary = {
  readonly retried: number;
  readonly published: number;
  readonly failed: number;
  readonly exhausted: number;
};

const DEFAULT_LIMIT = 50;
const MAX_REASON_LENGTH = 500;
const MAX_ATTEMPTS = 3;

/** Backoff before retry N (1-indexed): 1s, 2s, 4s, as required by `docs/DecorAR.md`. */
const BACKOFF_MS = [1000, 2000, 4000];

const describeFailure = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause);

  return message.slice(0, MAX_REASON_LENGTH) || "unknown error";
};

/**
 * Bounded retry of events the initial drain (DECOR-32) left `pending` with
 * one to three prior attempts. Waits 1, 2 or 4 seconds (by current
 * `attempts`) before reclaiming, publishes, and marks `published` only on
 * success. A failure on the third retry (`attempts` was already
 * `MAX_ATTEMPTS`) moves the event to `failed` instead of leaving it
 * `pending` forever, so it never retries a fourth time; a failure on an
 * earlier retry simply stays `pending` for the next round.
 *
 * `claimRetry` increments `attempts` only if it still matches what this
 * worker read, so two concurrent retry rounds never both reclaim the same
 * event for the same retry number.
 */
export class RetryOutboxUseCase {
  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
    private readonly sleep: Sleep,
    private readonly logger?: Logger,
  ) {}

  async execute(limit = DEFAULT_LIMIT): Promise<Result<RetryOutboxSummary, DomainError>> {
    const listed = await this.store.listRetryable(limit);

    if (!listed.ok) {
      return err(listed.error);
    }

    let retried = 0;
    let published = 0;
    let failed = 0;
    let exhausted = 0;

    for (const candidate of listed.value) {
      const delay = BACKOFF_MS[candidate.attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      await this.sleep.wait(delay);

      const claimed = await this.store.claimRetry(candidate.eventId, candidate.attempts);

      if (!claimed.ok) {
        return err(claimed.error);
      }

      if (claimed.value === null) {
        // Another worker already advanced this event past this retry number.
        continue;
      }

      retried += 1;
      const { eventId, event, attempts, correlationId } = claimed.value;
      const isLastRetry = attempts > MAX_ATTEMPTS;

      const parsed = parseDomainEvent(event);

      if (!parsed.ok) {
        failed += 1;
        await this.recordOutcome(eventId, attempts, correlationId, isLastRetry, parsed.error.message);
        if (isLastRetry) exhausted += 1;
        continue;
      }

      try {
        await this.publisher.publish(parsed.value);
      } catch (cause) {
        failed += 1;
        const reason = describeFailure(cause);
        await this.recordOutcome(eventId, attempts, correlationId, isLastRetry, reason);
        if (isLastRetry) exhausted += 1;
        continue;
      }

      const marked = await this.store.markPublished(eventId);

      if (marked.ok) {
        published += 1;
        this.logger?.info("outbox event published on retry", {
          attempt: attempts,
          component: "events.retry-outbox",
          correlationId,
          eventId,
        });
      } else {
        // Published but not marked: stays pending; a later round republishes it.
        failed += 1;
      }
    }

    return ok({ exhausted, failed, published, retried });
  }

  private async recordOutcome(
    eventId: string,
    attempt: number,
    correlationId: string | null,
    isLastRetry: boolean,
    reason: string,
  ): Promise<void> {
    this.logger?.warn(isLastRetry ? "outbox event exhausted its retries" : "outbox retry failed", {
      attempt,
      component: "events.retry-outbox",
      correlationId,
      error: reason,
      eventId,
    });

    if (isLastRetry) {
      await this.store.markFailed(eventId, reason);
    } else {
      await this.store.recordFailure(eventId, reason);
    }
  }
}
