import { describe, expect, it } from "vitest";

import { canTransition, isQuoteStatus, validarTransicionEstado } from "./quote-status";

describe("estados de cotización (DECOR-50)", () => {
  it.each([
    ["draft", "sent"],
    ["draft", "expired"],
    ["sent", "accepted"],
    ["sent", "expired"],
  ] as const)("permite %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(validarTransicionEstado(from, to)).toEqual({ ok: true, value: to });
  });

  it.each([
    ["draft", "accepted"],
    ["draft", "draft"],
    ["sent", "draft"],
    ["accepted", "draft"],
    ["accepted", "expired"],
    ["expired", "sent"],
  ] as const)("rechaza %s → %s", (from, to) => {
    const result = validarTransicionEstado(from, to);
    expect(!result.ok && result.error.code).toBe("quote.invalid_status_transition");
  });

  it("rechaza un estado desconocido", () => {
    const result = validarTransicionEstado("draft", "cancelled");
    expect(!result.ok && result.error.code).toBe("quote.invalid_status");
    expect(isQuoteStatus("sent")).toBe(true);
    expect(isQuoteStatus(1)).toBe(false);
  });
});
