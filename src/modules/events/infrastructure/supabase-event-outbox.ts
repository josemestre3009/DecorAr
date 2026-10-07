import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type {
  ClaimedOutboxEvent,
  OutboxStore,
  PackageChangeEvent,
  PackageChangeOutbox,
} from "../application/outbox";

/** Codes raised by `public.commit_package_change` with RAISE EXCEPTION. */
const KNOWN_CODES = new Set([
  "package.not_found",
  "package.item_not_found",
  "package.version_conflict",
  "event.duplicate",
  "event.invalid",
  "event.unsupported_type",
  "event.unsupported_version",
]);

const FOREIGN_KEY_VIOLATION = "23503";

type RpcError = { readonly code?: string; readonly message: string };

const persistenceError = (cause: unknown): DomainError =>
  new DomainError(
    "outbox.persistence_error",
    cause instanceof Error || (typeof cause === "object" && cause !== null && "message" in cause)
      ? String((cause as { message: unknown }).message)
      : "Unexpected outbox failure",
    { cause },
  );

const toDomainError = (error: RpcError): DomainError => {
  if (KNOWN_CODES.has(error.message)) {
    return new DomainError(error.message, error.message, { cause: error });
  }

  if (error.code === FOREIGN_KEY_VIOLATION) {
    return new DomainError("package.module_not_found", "El módulo no existe en el catálogo", {
      cause: error,
    });
  }

  return persistenceError(error);
};

type ClaimRow = { event_id: string; event: unknown };

/**
 * Server-only adapter over the outbox RPCs. Must be built with the
 * service-role client: the outbox and its functions deny anon/authenticated.
 */
export class SupabaseEventOutbox implements PackageChangeOutbox, OutboxStore {
  constructor(private readonly client: SupabaseClient) {}

  async commit(
    event: PackageChangeEvent,
    expectedVersion?: number,
  ): Promise<Result<number, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("commit_package_change", {
        p_event: event,
        p_expected_version: expectedVersion ?? null,
      });

      if (error) return err(toDomainError(error));
      if (typeof data !== "number") return err(persistenceError(new Error("Invalid package version")));

      return ok(data);
    } catch (cause) {
      return err(persistenceError(cause));
    }
  }

  async claimInitial(limit: number): Promise<Result<readonly ClaimedOutboxEvent[], DomainError>> {
    try {
      const { data, error } = await this.client.rpc("claim_initial_domain_events", {
        p_limit: limit,
      });

      if (error) return err(persistenceError(error));

      return ok(((data ?? []) as ClaimRow[]).map((row) => ({ event: row.event, eventId: row.event_id })));
    } catch (cause) {
      return err(persistenceError(cause));
    }
  }

  async markPublished(eventId: string): Promise<Result<void, DomainError>> {
    return this.call("mark_domain_event_published", { p_event_id: eventId });
  }

  async recordFailure(eventId: string, reason: string): Promise<Result<void, DomainError>> {
    return this.call("record_domain_event_failure", { p_error: reason, p_event_id: eventId });
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<Result<void, DomainError>> {
    try {
      const { error } = await this.client.rpc(fn, args);

      return error ? err(persistenceError(error)) : ok(undefined);
    } catch (cause) {
      return err(persistenceError(cause));
    }
  }
}
