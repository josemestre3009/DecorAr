import { describe, expect, it } from "vitest";

import { parseDomainEvent, packageChannel, type DomainEvent } from "./event-contracts";
import {
  budgetRecalculatedExample,
  packageModuleAddedExample,
  packageModuleRemovedExample,
} from "./event-examples";

const clone = (event: DomainEvent): Record<string, unknown> => JSON.parse(JSON.stringify(event));

describe("event contracts", () => {
  it.each([packageModuleAddedExample, packageModuleRemovedExample, budgetRecalculatedExample])(
    "acepta el ejemplo de $type con schemaVersion 1",
    (example) => {
      const parsed = parseDomainEvent(clone(example));

      expect(parsed).toEqual({ ok: true, value: example });
    },
  );

  it("conserva identificadores y fecha que reconocen el origen", () => {
    const parsed = parseDomainEvent(clone(packageModuleAddedExample));

    expect(parsed.ok && parsed.value).toMatchObject({
      eventId: packageModuleAddedExample.eventId,
      userId: packageModuleAddedExample.userId,
      packageId: packageModuleAddedExample.packageId,
      occurredAt: "2026-10-02T15:04:05.000Z",
    });
  });

  it.each([2, 0, "1", null])("rechaza la versión desconocida %j", (schemaVersion) => {
    const parsed = parseDomainEvent({ ...clone(packageModuleAddedExample), schemaVersion });

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.code).toBe("event.unsupported_version");
    expect(!parsed.ok && parsed.error.message).toContain("Versión de evento no soportada");
  });

  it.each([
    ["BigInt", BigInt(2)],
    ["objeto circular", (() => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    })()],
  ])("rechaza una versión %s sin lanzar", (_, schemaVersion) => {
    const parsed = parseDomainEvent({ ...clone(packageModuleAddedExample), schemaVersion });

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.code).toBe("event.unsupported_version");
  });

  it.each(["eventId", "type", "schemaVersion", "occurredAt", "userId", "packageId", "payload"])(
    "rechaza un evento sin %s",
    (field) => {
      const event = clone(packageModuleAddedExample);
      delete event[field];

      const parsed = parseDomainEvent(event);

      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.error.code).toBe("event.invalid");
      expect(!parsed.ok && parsed.error.message).toContain(field);
    },
  );

  it.each([
    [packageModuleRemovedExample, "itemId"],
    [packageModuleRemovedExample, "moduleId"],
    [budgetRecalculatedExample, "budgetId"],
    [budgetRecalculatedExample, "totalCop"],
    [budgetRecalculatedExample, "causationEventId"],
  ] as const)("rechaza $type sin payload.%s", (example, field) => {
    const event = clone(example);
    delete (event.payload as Record<string, unknown>)[field];

    const parsed = parseDomainEvent(event);

    expect(!parsed.ok && parsed.error.message).toContain(`payload.${field}`);
  });

  it("rechaza un tipo desconocido nombrándolo", () => {
    const parsed = parseDomainEvent({ ...clone(packageModuleAddedExample), type: "package.deleted" });

    expect(!parsed.ok && parsed.error.message).toContain("package.deleted");
  });

  it.each([
    ["occurredAt no UTC", { occurredAt: "2026-10-02 15:04" }],
    ["occurredAt inexistente", { occurredAt: "2026-02-30T00:00:00.000Z" }],
    ["totalCop no entero", { payload: { ...budgetRecalculatedExample.payload, totalCop: 10.5 } }],
    ["totalCop negativo", { payload: { ...budgetRecalculatedExample.payload, totalCop: -1 } }],
  ])("rechaza %s", (_, override) => {
    const parsed = parseDomainEvent({ ...clone(budgetRecalculatedExample), ...override });

    expect(!parsed.ok && parsed.error.code).toBe("event.invalid");
  });

  it.each([
    "2024-02-29T00:00:00Z",
    "2026-01-01T00:00:00.1Z",
    "2026-01-01T00:00:00.12Z",
    "2026-01-01T00:00:00.123Z",
  ])("acepta la fecha UTC válida %s", (occurredAt) => {
    expect(parseDomainEvent({ ...clone(packageModuleAddedExample), occurredAt }).ok).toBe(true);
  });

  it.each([null, "evento", []])("rechaza una entrada que no es objeto (%j) sin lanzar", (input) => {
    expect(parseDomainEvent(input).ok).toBe(false);
  });

  it("rechaza un objeto no procesable sin lanzar", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(parseDomainEvent(proxy).ok).toBe(false);
  });

  it("define el canal privado del paquete", () => {
    expect(packageChannel("2b7e1516")).toBe("package:2b7e1516");
  });
});
