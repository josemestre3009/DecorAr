import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { PackageModuleAddedEvent, PackageModuleRemovedEvent } from "../domain/event-contracts";

export type PackageChangeEvent = PackageModuleAddedEvent | PackageModuleRemovedEvent;

/**
 * Contract agreed with DECOR-27. Applies the package change described by the
 * event and stores the event in the outbox in a single PostgreSQL transaction.
 * Resolves to the new package version. `correlationId` (DECOR-31) is stored
 * alongside the event for logs; it is request metadata, not part of the
 * versioned event contract (DECOR-29).
 *
 * Error codes: `package.not_found`, `package.item_not_found`,
 * `package.module_not_found`, `package.version_conflict`, `event.duplicate`,
 * `event.invalid`, `event.unsupported_type`, `event.unsupported_version`,
 * `outbox.persistence_error`.
 */
export interface PackageChangeOutbox {
  commit(
    event: PackageChangeEvent,
    expectedVersion?: number,
    correlationId?: string,
  ): Promise<Result<number, DomainError>>;
}

export type ClaimedOutboxEvent = {
  readonly eventId: string;
  readonly event: unknown;
};

/** A pending event with one to three prior attempts, eligible for a bounded retry (DECOR-31). */
export type RetryableOutboxEvent = {
  readonly eventId: string;
  readonly event: unknown;
  readonly attempts: number;
  readonly correlationId: string | null;
};

/** A pending or failed event, for the recovery endpoint's visibility (DECOR-31). */
export type UnresolvedOutboxEvent = {
  readonly eventId: string;
  readonly status: "pending" | "failed";
  readonly attempts: number;
  readonly lastError: string | null;
  readonly correlationId: string | null;
  readonly packageId: string;
};

/** Server-only access to the outbox for the initial delivery attempt. */
export interface OutboxStore {
  /** Claims never-attempted pending events and records the attempt atomically. */
  claimInitial(limit: number): Promise<Result<readonly ClaimedOutboxEvent[], DomainError>>;
  markPublished(eventId: string): Promise<Result<void, DomainError>>;
  recordFailure(eventId: string, reason: string): Promise<Result<void, DomainError>>;
  /** Lists pending events with one to three prior attempts, oldest first (DECOR-31). */
  listRetryable(limit: number): Promise<Result<readonly RetryableOutboxEvent[], DomainError>>;
  /**
   * Claims one retry: increments `attempts` only if the event is still
   * `pending` with exactly `expectedAttempts`, so two concurrent retries of
   * the same event and the same retry number never both succeed. `null`
   * means another worker (or a terminal state) already moved it.
   */
  claimRetry(
    eventId: string,
    expectedAttempts: number,
  ): Promise<Result<RetryableOutboxEvent | null, DomainError>>;
  /** Moves an event that exhausted its retries to `failed`, for reconciliation (DECOR-31). */
  markFailed(eventId: string, reason: string): Promise<Result<void, DomainError>>;
  /** Lists pending and failed events for the recovery endpoint (DECOR-31). */
  listUnresolved(limit: number): Promise<Result<readonly UnresolvedOutboxEvent[], DomainError>>;
}
