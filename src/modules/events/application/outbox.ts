import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { PackageModuleAddedEvent, PackageModuleRemovedEvent } from "../domain/event-contracts";

export type PackageChangeEvent = PackageModuleAddedEvent | PackageModuleRemovedEvent;

/**
 * Contract agreed with DECOR-27. Applies the package change described by the
 * event and stores the event in the outbox in a single PostgreSQL transaction.
 * Resolves to the new package version.
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
  ): Promise<Result<number, DomainError>>;
}

export type ClaimedOutboxEvent = {
  readonly eventId: string;
  readonly event: unknown;
};

/** Server-only access to the outbox for the initial delivery attempt. */
export interface OutboxStore {
  /** Claims never-attempted pending events and records the attempt atomically. */
  claimInitial(limit: number): Promise<Result<readonly ClaimedOutboxEvent[], DomainError>>;
  markPublished(eventId: string): Promise<Result<void, DomainError>>;
  recordFailure(eventId: string, reason: string): Promise<Result<void, DomainError>>;
}
