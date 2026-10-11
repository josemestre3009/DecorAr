import { describe, expect, it, vi } from "vitest";

import { createJsonLogger } from "./json-logger";

vi.mock("server-only", () => ({}));

describe("createJsonLogger", () => {
  it("writes a JSON line with timestamp, level, message and sanitized context", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const clock = { now: () => new Date("2026-10-10T12:00:00.000Z") };
    const logger = createJsonLogger(clock);

    logger.info("outbox event published on retry", { attempt: 2, component: "events.retry-outbox", eventId: "evt-1" });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toEqual({
      context: { attempt: 2, component: "events.retry-outbox", eventId: "evt-1" },
      level: "info",
      message: "outbox event published on retry",
      timestamp: "2026-10-10T12:00:00.000Z",
    });

    spy.mockRestore();
  });

  it("never lets a secret reach the written line", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const clock = { now: () => new Date("2026-10-10T12:00:00.000Z") };
    const logger = createJsonLogger(clock);

    logger.error("recovery endpoint unexpected failure", {
      authorization: "Bearer sb_secret_abc123",
      component: "recovery",
      userEmail: "lsilva29052005@gmail.com",
    });

    const written = spy.mock.calls[0][0] as string;
    expect(written).not.toContain("sb_secret_abc123");
    expect(written).not.toContain("lsilva29052005@gmail.com");
    expect(JSON.parse(written).level).toBe("error");

    spy.mockRestore();
  });

  it("routes each level to its matching console method", () => {
    const clock = { now: () => new Date("2026-10-10T12:00:00.000Z") };
    const logger = createJsonLogger(clock);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logger.debug("d");
    logger.warn("w");

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    debugSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("writes a line without a context property when none is given", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const clock = { now: () => new Date("2026-10-10T12:00:00.000Z") };

    createJsonLogger(clock).info("no context here");

    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.context).toBeUndefined();
    expect(line.message).toBe("no context here");

    spy.mockRestore();
  });
});
