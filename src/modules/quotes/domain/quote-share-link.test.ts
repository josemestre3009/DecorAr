import { describe, expect, it } from "vitest";

import {
  canShareQuote,
  endOfDayInQuoteTimeZone,
  resolveShareExpiry,
  validarCotizacionCompartible,
} from "./quote-share-link";

describe("canShareQuote (DECOR-53)", () => {
  it.each([
    ["sent", true],
    ["accepted", true],
    ["draft", false],
    ["expired", false],
  ] as const)("%s → %s", (status, expected) => {
    expect(canShareQuote(status)).toBe(expected);
  });
});

describe("validarCotizacionCompartible (DECOR-53)", () => {
  it("acepta enviada y aceptada", () => {
    expect(validarCotizacionCompartible("sent")).toEqual({ ok: true, value: "sent" });
    expect(validarCotizacionCompartible("accepted")).toEqual({ ok: true, value: "accepted" });
  });

  it.each(["draft", "expired"] as const)("rechaza %s", (status) => {
    const result = validarCotizacionCompartible(status);
    expect(!result.ok && result.error.code).toBe("quote.share_not_allowed");
  });
});

describe("endOfDayInQuoteTimeZone (DECOR-53)", () => {
  it("es la medianoche de Bogotá del día siguiente, en UTC", () => {
    // America/Bogota es UTC-5 todo el año (sin horario de verano): la
    // medianoche local del 2 de diciembre es las 05:00 UTC del mismo día.
    const end = endOfDayInQuoteTimeZone("2026-12-01");
    expect(end.toISOString()).toBe("2026-12-02T05:00:00.000Z");
  });
});

describe("resolveShareExpiry (DECOR-53)", () => {
  it("devuelve el fin del día de la vigencia cuando aún no pasó", () => {
    const now = new Date("2026-11-20T12:00:00.000Z");
    const result = resolveShareExpiry("2026-12-01", now);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.toISOString()).toBe("2026-12-02T05:00:00.000Z");
  });

  it("rechaza una vigencia que ya pasó", () => {
    const now = new Date("2026-12-05T00:00:00.000Z");
    const result = resolveShareExpiry("2026-12-01", now);

    expect(!result.ok && result.error.code).toBe("quote.share_expiry_too_far");
  });
});
