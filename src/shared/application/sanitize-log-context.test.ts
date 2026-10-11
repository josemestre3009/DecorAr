import { describe, expect, it } from "vitest";

import { sanitizeLogContext } from "./sanitize-log-context";

describe("sanitizeLogContext", () => {
  it("returns undefined when given undefined", () => {
    expect(sanitizeLogContext(undefined)).toBeUndefined();
  });

  it("redacts a value whose key contains token, cookie, authorization, key, secret or password", () => {
    const sanitized = sanitizeLogContext({
      accessToken: "abc.def.ghi",
      apiKey: "sk_live_12345",
      authorization: "Bearer abc",
      cookieHeader: "session=abc",
      servicePassword: "hunter2",
      supabaseSecret: "sb_secret_value",
    });

    expect(sanitized).toEqual({
      accessToken: "[redacted]",
      apiKey: "[redacted]",
      authorization: "[redacted]",
      cookieHeader: "[redacted]",
      servicePassword: "[redacted]",
      supabaseSecret: "[redacted]",
    });
  });

  it("never includes a raw event payload: the key itself is redacted", () => {
    const sanitized = sanitizeLogContext({
      eventId: "evt-1",
      payload: { itemId: "item-1", moduleId: "mod-1" },
    });

    expect(sanitized).toEqual({ eventId: "evt-1", payload: "[redacted]" });
  });

  it("masks a full email found as a string value", () => {
    const sanitized = sanitizeLogContext({ userEmail: "lsilva29052005@gmail.com" });

    expect(sanitized).toEqual({ userEmail: "l***@gmail.com" });
  });

  it("masks a bearer token or JWT found inside a message string", () => {
    const sanitized = sanitizeLogContext({
      detail: "rejected Authorization: Bearer abcdef123456.secondpart more text",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    });

    expect(sanitized!.jwt).toBe("[redacted]");
    expect(String(sanitized!.detail)).toContain("Bearer [redacted]");
    expect(String(sanitized!.detail)).not.toContain("abcdef123456");
  });

  it("sanitizes an Error value down to a safe shape", () => {
    const error = new Error("failed for lsilva29052005@gmail.com");
    const sanitized = sanitizeLogContext({ error });

    expect(sanitized!.error).toMatchObject({ message: "failed for l***@gmail.com", name: "Error" });
    expect(sanitized!.error).not.toHaveProperty("stack");
  });

  it("recurses into nested objects and arrays", () => {
    const sanitized = sanitizeLogContext({
      nested: { secretKey: "s3cr3t", values: ["a@b.com", { token: "x" }] },
    });

    expect(sanitized).toEqual({
      nested: {
        secretKey: "[redacted]",
        values: ["a***@b.com", { token: "[redacted]" }],
      },
    });
  });

  it("redacts beyond a bounded depth instead of hanging on a pathological context", () => {
    const deep: Record<string, unknown> = { value: "leaf" };
    let cursor = deep;
    for (let i = 0; i < 10; i += 1) {
      const next: Record<string, unknown> = { value: "leaf" };
      cursor.child = next;
      cursor = next;
    }

    expect(() => sanitizeLogContext({ deep })).not.toThrow();
  });

  it("never throws even for a context that cannot be enumerated normally", () => {
    const hostile = {
      get boom(): string {
        throw new Error("boom");
      },
    };

    expect(() => sanitizeLogContext(hostile as unknown as Record<string, unknown>)).not.toThrow();
  });

  it("leaves ordinary, non-sensitive values untouched", () => {
    const sanitized = sanitizeLogContext({ attempt: 2, component: "events.retry-outbox", eventId: "evt-1" });

    expect(sanitized).toEqual({ attempt: 2, component: "events.retry-outbox", eventId: "evt-1" });
  });
});
