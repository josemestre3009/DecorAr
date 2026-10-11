import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok } from "../../../shared/domain/result";
import type { Sleep } from "../../../shared/application/ports";
import type { DomainEvent } from "../domain/event-contracts";
import { packageModuleAddedExample } from "../domain/event-examples";
import { RetryOutboxUseCase } from "./retry-outbox.use-case";
import type { EventPublisher } from "./event-publisher";
import type { OutboxStore, RetryableOutboxEvent } from "./outbox";

type Row = {
  eventId: string;
  event: unknown;
  status: "pending" | "published" | "failed";
  attempts: number;
  correlationId: string | null;
  error?: string;
};

/**
 * In-memory outbox with the same retry claim semantics as the SQL
 * function: `claimRetry` only advances `attempts` when it matches what the
 * caller already read, mirroring `claim_retry_domain_event`.
 */
function memoryStore(events: readonly { event: unknown; attempts: number; correlationId?: string }[]) {
  const rows: Row[] = events.map(({ event, attempts, correlationId }) => ({
    attempts,
    correlationId: correlationId ?? null,
    event,
    eventId: (event as { eventId: string }).eventId,
    status: "pending",
  }));

  const store: OutboxStore = {
    claimInitial: vi.fn(),
    claimRetry: vi.fn(async (eventId: string, expectedAttempts: number) => {
      const row = rows.find((r) => r.eventId === eventId);
      if (!row || row.status !== "pending" || row.attempts !== expectedAttempts) {
        return ok(null);
      }
      row.attempts += 1;
      const result: RetryableOutboxEvent = {
        attempts: row.attempts,
        correlationId: row.correlationId,
        event: row.event,
        eventId: row.eventId,
      };
      return ok(result);
    }),
    listRetryable: vi.fn(async () =>
      ok(
        rows
          .filter((r) => r.status === "pending" && r.attempts >= 1 && r.attempts <= 3)
          .map((r) => ({
            attempts: r.attempts,
            correlationId: r.correlationId,
            event: r.event,
            eventId: r.eventId,
          })),
      ),
    ),
    listUnresolved: vi.fn(),
    markFailed: vi.fn(async (eventId: string, reason: string) => {
      const row = rows.find((r) => r.eventId === eventId);
      if (row) {
        row.status = "failed";
        row.error = reason;
      }
      return ok(undefined);
    }),
    markPublished: vi.fn(async (eventId: string) => {
      const row = rows.find((r) => r.eventId === eventId && r.status === "pending");
      if (row) row.status = "published";
      return ok(undefined);
    }),
    recordFailure: vi.fn(async (eventId: string, reason: string) => {
      const row = rows.find((r) => r.eventId === eventId);
      if (row) row.error = reason;
      return ok(undefined);
    }),
  };

  return { rows, store };
}

const publisherOk = (): EventPublisher & { publish: ReturnType<typeof vi.fn> } => ({
  publish: vi.fn(async () => undefined),
});

function fakeSleep(): Sleep & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    wait: async (ms: number) => {
      calls.push(ms);
    },
  };
}

describe("RetryOutboxUseCase", () => {
  it("recovers a transient failure on the first retry (attempts=1) and waits 1000ms", async () => {
    const { rows, store } = memoryStore([{ attempts: 1, event: packageModuleAddedExample }]);
    const publisher = publisherOk();
    const sleep = fakeSleep();

    const result = await new RetryOutboxUseCase(store, publisher, sleep).execute();

    expect(result).toEqual(ok({ exhausted: 0, failed: 0, published: 1, retried: 1 }));
    expect(sleep.calls).toEqual([1000]);
    expect(rows[0].status).toBe("published");
    expect(rows[0].attempts).toBe(2);
  });

  it("waits 2000ms for a second retry and 4000ms for a third", async () => {
    const { store } = memoryStore([
      { attempts: 2, event: { ...packageModuleAddedExample, eventId: "evt-2nd" } },
      { attempts: 3, event: { ...packageModuleAddedExample, eventId: "evt-3rd" } },
    ]);
    const publisher = publisherOk();
    const sleep = fakeSleep();

    await new RetryOutboxUseCase(store, publisher, sleep).execute();

    expect(sleep.calls).toEqual([2000, 4000]);
  });

  it("marks an event failed (not retried again) after exactly the third retry fails", async () => {
    const { rows, store } = memoryStore([{ attempts: 3, event: packageModuleAddedExample }]);
    const failing: EventPublisher = { publish: vi.fn().mockRejectedValue(new Error("down")) };
    const sleep = fakeSleep();

    const result = await new RetryOutboxUseCase(store, failing, sleep).execute();

    expect(result).toEqual(ok({ exhausted: 1, failed: 1, published: 0, retried: 1 }));
    expect(rows[0]).toMatchObject({ attempts: 4, error: "down", status: "failed" });
    expect(store.markFailed).toHaveBeenCalledWith(packageModuleAddedExample.eventId, "down");
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it("performs exactly three retries total across rounds for a permanently failing event, never a fourth", async () => {
    const { rows, store } = memoryStore([{ attempts: 1, event: packageModuleAddedExample }]);
    const failing: EventPublisher = { publish: vi.fn().mockRejectedValue(new Error("boom")) };
    const sleep = fakeSleep();

    // Round 1: attempts 1 -> 2, stays pending (not the last retry yet).
    await new RetryOutboxUseCase(store, failing, sleep).execute();
    expect(rows[0]).toMatchObject({ attempts: 2, status: "pending" });

    // Round 2: attempts 2 -> 3, stays pending.
    await new RetryOutboxUseCase(store, failing, sleep).execute();
    expect(rows[0]).toMatchObject({ attempts: 3, status: "pending" });

    // Round 3: attempts 3 -> 4, exhausted: moves to failed.
    await new RetryOutboxUseCase(store, failing, sleep).execute();
    expect(rows[0]).toMatchObject({ attempts: 4, status: "failed" });

    // A failed event is no longer retryable: a fourth round retries nothing.
    const fourth = await new RetryOutboxUseCase(store, failing, sleep).execute();
    expect(fourth).toEqual(ok({ exhausted: 0, failed: 0, published: 0, retried: 0 }));
    expect(failing.publish).toHaveBeenCalledTimes(3);
  });

  it("two concurrent retry rounds never both publish the same event for the same retry number", async () => {
    const { rows, store } = memoryStore([{ attempts: 1, event: packageModuleAddedExample }]);
    const published: string[] = [];
    const publisher: EventPublisher = {
      publish: vi.fn(async (event: DomainEvent) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        published.push(event.eventId);
      }),
    };
    const sleep = fakeSleep();

    const a = new RetryOutboxUseCase(store, publisher, sleep);
    const b = new RetryOutboxUseCase(store, publisher, sleep);
    await Promise.all([a.execute(), b.execute()]);

    expect(published).toHaveLength(1);
    expect(rows[0].status).toBe("published");
  });

  it("propagates correlationId from the claimed event into the publish success log", async () => {
    const { store } = memoryStore([
      { attempts: 1, correlationId: "corr-123", event: packageModuleAddedExample },
    ]);
    const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

    await new RetryOutboxUseCase(store, publisherOk(), fakeSleep(), logger).execute();

    expect(logger.info).toHaveBeenCalledWith(
      "outbox event published on retry",
      expect.objectContaining({ correlationId: "corr-123", eventId: packageModuleAddedExample.eventId }),
    );
  });

  it("logs a warning with correlationId when a retry fails without exhausting", async () => {
    const { store } = memoryStore([
      { attempts: 1, correlationId: "corr-456", event: packageModuleAddedExample },
    ]);
    const failing: EventPublisher = { publish: vi.fn().mockRejectedValue(new Error("Realtime 503")) };
    const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

    await new RetryOutboxUseCase(store, failing, fakeSleep(), logger).execute();

    expect(logger.warn).toHaveBeenCalledWith(
      "outbox retry failed",
      expect.objectContaining({ correlationId: "corr-456", error: "Realtime 503" }),
    );
  });

  it("records an invalid stored event as a failure without publishing it", async () => {
    const { rows, store } = memoryStore([
      { attempts: 1, event: { ...packageModuleAddedExample, schemaVersion: 2 } },
    ]);
    const publisher = publisherOk();

    const result = await new RetryOutboxUseCase(store, publisher, fakeSleep()).execute();

    expect(result).toEqual(ok({ exhausted: 0, failed: 1, published: 0, retried: 1 }));
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(rows[0].error).toContain("Versión de evento no soportada");
  });

  it("returns the listRetryable error without retrying anything", async () => {
    const { store } = memoryStore([]);
    const failure = new DomainError("outbox.persistence_error", "db down");
    vi.mocked(store.listRetryable).mockResolvedValue(err(failure));

    const result = await new RetryOutboxUseCase(store, publisherOk(), fakeSleep()).execute();

    expect(result).toEqual(err(failure));
  });

  it("passes the batch limit to the store", async () => {
    const { store } = memoryStore([]);

    await new RetryOutboxUseCase(store, publisherOk(), fakeSleep()).execute(5);

    expect(store.listRetryable).toHaveBeenCalledWith(5);
  });
});
