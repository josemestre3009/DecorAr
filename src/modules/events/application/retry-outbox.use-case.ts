import type { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Logger, Sleep } from "../../../shared/application/ports";
import { parseDomainEvent } from "../domain/event-contracts";
import type { EventPublisher } from "./event-publisher";
import type { OutboxStore, RetryableOutboxEvent } from "./outbox";

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
 * Candidates are processed concurrently: each waits its own backoff and
 * then publishes, so the round's wall time is the longest single backoff
 * (~4s) instead of the sum over up to 50 events. That keeps the HTTP
 * recovery endpoint inside a serverless function timeout regardless of the
 * backlog size. `claimRetry` increments `attempts` only if it still matches
 * what this worker read, so two concurrent retry rounds never both reclaim
 * the same event for the same retry number.
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

    const outcomes = await Promise.all(listed.value.map((candidate) => this.retryOne(candidate)));

    const failure = outcomes.find((outcome) => !outcome.ok);

    if (failure && !failure.ok) {
      return err(failure.error);
    }

    let retried = 0;
    let published = 0;
    let failed = 0;
    let exhausted = 0;

    for (const outcome of outcomes) {
      if (!outcome.ok || outcome.value === null) continue;

      retried += outcome.value.retried;
      published += outcome.value.published;
      failed += outcome.value.failed;
      exhausted += outcome.value.exhausted;
    }

    return ok({ exhausted, failed, published, retried });
  }

  private async retryOne(
    candidate: RetryableOutboxEvent,
  ): Promise<Result<RetryOutboxSummary | null, DomainError>> {
    const delay = BACKOFF_MS[candidate.attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    await this.sleep.wait(delay);

    const claimed = await this.store.claimRetry(candidate.eventId, candidate.attempts);

    if (!claimed.ok) {
      return err(claimed.error);
    }

    if (claimed.value === null) {
      // Another worker already advanced this event past this retry number.
      return ok(null);
    }

    const { eventId, event, attempts, correlationId } = claimed.value;
    const isLastRetry = attempts > MAX_ATTEMPTS;
    const parsed = parseDomainEvent(event);

    if (!parsed.ok) {
      await this.recordOutcome(eventId, attempts, correlationId, isLastRetry, parsed.error.message);
      return ok({ exhausted: isLastRetry ? 1 : 0, failed: 1, published: 0, retried: 1 });
    }

    try {
      await this.publisher.publish(parsed.value);
    } catch (cause) {
      await this.recordOutcome(eventId, attempts, correlationId, isLastRetry, describeFailure(cause));
      return ok({ exhausted: isLastRetry ? 1 : 0, failed: 1, published: 0, retried: 1 });
    }

    const marked = await this.store.markPublished(eventId);

    if (marked.ok) {
      this.logger?.info("outbox event published on retry", {
        attempt: attempts,
        component: "events.retry-outbox",
        correlationId,
        eventId,
      });
      return ok({ exhausted: 0, failed: 0, published: 1, retried: 1 });
    }

    // Published but not marked. Normally it stays `pending` for a later round,
    // but at the last retry that round never comes (`attempts > MAX_ATTEMPTS`
    // is excluded from `listRetryable`), so move it to `failed` for
    // reconciliation instead of leaving it pending forever.
    if (isLastRetry) {
      await this.store.markFailed(eventId, "published but the published mark failed");
      return ok({ exhausted: 1, failed: 1, published: 0, retried: 1 });
    }

    return ok({ exhausted: 0, failed: 1, published: 0, retried: 1 });
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
