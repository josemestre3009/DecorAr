import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok } from "../../../shared/domain/result";
import type { DomainEvent } from "../domain/event-contracts";
import { packageModuleAddedExample, packageModuleRemovedExample } from "../domain/event-examples";
import { DrainOutboxUseCase } from "./drain-outbox.use-case";
import type { EventPublisher } from "./event-publisher";
import type { ClaimedOutboxEvent, OutboxStore } from "./outbox";

type Row = { eventId: string; event: unknown; status: "pending" | "published"; attempts: number; error?: string };

/**
 * In-memory outbox with the same claim semantics as the SQL function: a claim
 * only takes never-attempted pending rows and records the attempt atomically.
 */
function memoryStore(events: unknown[]) {
  const rows: Row[] = events.map((event) => ({
    attempts: 0,
    event,
    eventId: (event as { eventId: string }).eventId,
    status: "pending",
  }));

  const store: OutboxStore = {
    claimInitial: vi.fn(async (limit: number) => {
      const claimed: ClaimedOutboxEvent[] = [];
      for (const row of rows) {
        if (claimed.length >= limit) break;
        if (row.status === "pending" && row.attempts === 0) {
          row.attempts += 1;
          claimed.push({ event: row.event, eventId: row.eventId });
        }
      }
      return ok(claimed);
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

describe("DrainOutboxUseCase", () => {
  it("publishes claimed events and marks them published only after success", async () => {
    const { rows, store } = memoryStore([packageModuleAddedExample, packageModuleRemovedExample]);
    const order: string[] = [];
    const publisher: EventPublisher = {
      publish: vi.fn(async (event: DomainEvent) => {
        order.push(`publish:${event.eventId}`);
        expect(rows.find((r) => r.eventId === event.eventId)?.status).toBe("pending");
      }),
    };
    vi.mocked(store.markPublished).mockImplementation(async (eventId) => {
      order.push(`mark:${eventId}`);
      rows.find((r) => r.eventId === eventId)!.status = "published";
      return ok(undefined);
    });

    const result = await new DrainOutboxUseCase(store, publisher).execute();

    expect(result).toEqual(ok({ claimed: 2, failed: 0, published: 2 }));
    expect(publisher.publish).toHaveBeenCalledWith(packageModuleAddedExample);
    expect(order).toEqual([
      `publish:${packageModuleAddedExample.eventId}`,
      `mark:${packageModuleAddedExample.eventId}`,
      `publish:${packageModuleRemovedExample.eventId}`,
      `mark:${packageModuleRemovedExample.eventId}`,
    ]);
    expect(rows.every((r) => r.status === "published")).toBe(true);
  });

  it("leaves a failed publication pending with its attempt and error", async () => {
    const { rows, store } = memoryStore([packageModuleAddedExample]);
    const publisher: EventPublisher = {
      publish: vi.fn(async () => {
        throw new Error("Realtime 503");
      }),
    };

    const result = await new DrainOutboxUseCase(store, publisher).execute();

    expect(result).toEqual(ok({ claimed: 1, failed: 1, published: 0 }));
    expect(store.markPublished).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ attempts: 1, error: "Realtime 503", status: "pending" });
  });

  it("makes only the initial attempt: a failed event is not retried by a later drain", async () => {
    const { store } = memoryStore([packageModuleAddedExample]);
    const failing: EventPublisher = { publish: vi.fn().mockRejectedValue(new Error("down")) };
    const healthy = publisherOk();

    await new DrainOutboxUseCase(store, failing).execute();
    const second = await new DrainOutboxUseCase(store, healthy).execute();

    expect(second).toEqual(ok({ claimed: 0, failed: 0, published: 0 }));
    expect(healthy.publish).not.toHaveBeenCalled();
  });

  it("two concurrent drainers never publish the same event twice", async () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      ...packageModuleAddedExample,
      eventId: `evt-${index}`,
    }));
    const { rows, store } = memoryStore(events);
    const published: string[] = [];
    const publisher: EventPublisher = {
      publish: vi.fn(async (event: DomainEvent) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        published.push(event.eventId);
      }),
    };

    const a = new DrainOutboxUseCase(store, publisher);
    const b = new DrainOutboxUseCase(store, publisher);
    await Promise.all([a.execute(7), b.execute(7), a.execute(7), b.execute(7)]);

    expect(new Set(published).size).toBe(published.length);
    expect(published).toHaveLength(20);
    expect(rows.every((r) => r.status === "published" && r.attempts === 1)).toBe(true);
  });

  it("records invalid stored events as failures without publishing them", async () => {
    const { rows, store } = memoryStore([{ ...packageModuleAddedExample, schemaVersion: 2 }]);
    const publisher = publisherOk();

    const result = await new DrainOutboxUseCase(store, publisher).execute();

    expect(result).toEqual(ok({ claimed: 1, failed: 1, published: 0 }));
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(rows[0].error).toContain("Versión de evento no soportada");
  });

  it("counts an event published but not marked as failed (stays pending for DECOR-31)", async () => {
    const { store } = memoryStore([packageModuleAddedExample]);
    vi.mocked(store.markPublished).mockResolvedValue(err(new DomainError("outbox.persistence_error", "x")));

    const result = await new DrainOutboxUseCase(store, publisherOk()).execute();

    expect(result).toEqual(ok({ claimed: 1, failed: 1, published: 0 }));
  });

  it("returns the claim error without publishing", async () => {
    const { store } = memoryStore([]);
    const failure = new DomainError("outbox.persistence_error", "db down");
    vi.mocked(store.claimInitial).mockResolvedValue(err(failure));
    const publisher = publisherOk();

    const result = await new DrainOutboxUseCase(store, publisher).execute();

    expect(result).toEqual(err(failure));
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("passes the batch limit to the store", async () => {
    const { store } = memoryStore([]);

    await new DrainOutboxUseCase(store, publisherOk()).execute(5);

    expect(store.claimInitial).toHaveBeenCalledWith(5);
  });
});
