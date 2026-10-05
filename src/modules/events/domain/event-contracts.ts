import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

export const EVENT_SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
  "package.module.added",
  "package.module.removed",
  "budget.recalculated",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

type EventEnvelope<TType extends EventType, TPayload> = {
  readonly eventId: string;
  readonly type: TType;
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  /** ISO 8601 UTC, e.g. 2026-10-02T15:04:05.000Z */
  readonly occurredAt: string;
  readonly userId: string;
  readonly packageId: string;
  readonly payload: TPayload;
};

export type PackageModulePayload = {
  readonly itemId: string;
  readonly moduleId: string;
};

export type BudgetRecalculatedPayload = {
  readonly budgetId: string;
  /** Integer amount in COP. */
  readonly totalCop: number;
  readonly causationEventId: string;
};

export type PackageModuleAddedEvent = EventEnvelope<"package.module.added", PackageModulePayload>;
export type PackageModuleRemovedEvent = EventEnvelope<"package.module.removed", PackageModulePayload>;
export type BudgetRecalculatedEvent = EventEnvelope<"budget.recalculated", BudgetRecalculatedPayload>;

export type DomainEvent =
  | PackageModuleAddedEvent
  | PackageModuleRemovedEvent
  | BudgetRecalculatedEvent;

export const packageChannel = (packageId: string): string => `package:${packageId}`;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const PAYLOAD_FIELDS: Record<EventType, Readonly<Record<string, "string" | "nonNegativeInteger">>> = {
  "package.module.added": { itemId: "string", moduleId: "string" },
  "package.module.removed": { itemId: "string", moduleId: "string" },
  "budget.recalculated": {
    budgetId: "string",
    totalCop: "nonNegativeInteger",
    causationEventId: "string",
  },
};

const ENVELOPE_STRING_FIELDS = ["eventId", "occurredAt", "userId", "packageId"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isEventType = (value: unknown): value is EventType =>
  typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);

const invalid = (message: string) => err(new DomainError("event.invalid", message));

/**
 * Validates untrusted input against the MVP event contract (schemaVersion 1).
 * Never throws: returns a DomainError with code `event.invalid` or `event.unsupported_version`.
 */
export function parseDomainEvent(input: unknown): Result<DomainEvent, DomainError> {
  if (!isRecord(input)) {
    return invalid("Evento inválido: se esperaba un objeto");
  }

  if (!("schemaVersion" in input)) {
    return invalid("Evento inválido: falta el campo obligatorio schemaVersion");
  }

  if (input.schemaVersion !== EVENT_SCHEMA_VERSION) {
    return err(
      new DomainError(
        "event.unsupported_version",
        `Versión de evento no soportada: ${JSON.stringify(input.schemaVersion)}; se esperaba ${EVENT_SCHEMA_VERSION}`,
      ),
    );
  }

  if (!isNonEmptyString(input.type)) {
    return invalid("Evento inválido: falta el campo obligatorio type");
  }

  if (!isEventType(input.type)) {
    return invalid(`Evento inválido: tipo desconocido ${JSON.stringify(input.type)}`);
  }

  for (const field of ENVELOPE_STRING_FIELDS) {
    if (!isNonEmptyString(input[field])) {
      return invalid(`Evento inválido: falta el campo obligatorio ${field}`);
    }
  }

  if (!ISO_UTC.test(input.occurredAt as string) || Number.isNaN(Date.parse(input.occurredAt as string))) {
    return invalid("Evento inválido: occurredAt debe ser una fecha ISO 8601 en UTC");
  }

  if (!isRecord(input.payload)) {
    return invalid("Evento inválido: falta el campo obligatorio payload");
  }

  for (const [field, kind] of Object.entries(PAYLOAD_FIELDS[input.type])) {
    const value = input.payload[field];

    if (value === undefined) {
      return invalid(`Evento inválido: falta el campo obligatorio payload.${field}`);
    }

    const valid =
      kind === "string"
        ? isNonEmptyString(value)
        : typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

    if (!valid) {
      return invalid(`Evento inválido: payload.${field} tiene un valor no válido`);
    }
  }

  return ok(input as DomainEvent);
}
