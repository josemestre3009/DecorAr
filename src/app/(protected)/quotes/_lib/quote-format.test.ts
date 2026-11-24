import { describe, expect, it } from "vitest";

import {
  bpToPercentInput,
  formatRateBp,
  parsePercentToBp,
  quoteStatusLabel,
  quoteTitle,
  todayInBogota,
} from "./quote-format";

describe("quote-format (DECOR-51)", () => {
  it("muestra tasas en puntos básicos como porcentaje es-CO", () => {
    expect(formatRateBp(1_900)).toBe("19 %");
    expect(formatRateBp(1_250)).toBe("12,5 %");
    expect(formatRateBp(0)).toBe("0 %");
    expect(formatRateBp(10_000)).toBe("100 %");
  });

  it("traduce los estados y arma el título", () => {
    expect(quoteStatusLabel("draft")).toBe("Borrador");
    expect(quoteStatusLabel("sent")).toBe("Enviada");
    expect(quoteStatusLabel("accepted")).toBe("Aceptada");
    expect(quoteStatusLabel("expired")).toBe("Vencida");
    expect(quoteTitle(12, 2)).toBe("Cotización N.º 12 · versión 2");
  });

  it("convierte porcentajes escritos a puntos básicos", () => {
    expect(parsePercentToBp("19", "El impuesto", null)).toEqual({ ok: true, value: 1_900 });
    expect(parsePercentToBp("12,5", "El descuento", 0)).toEqual({ ok: true, value: 1_250 });
    expect(parsePercentToBp("0.25", "El descuento", 0)).toEqual({ ok: true, value: 25 });
    expect(parsePercentToBp("  ", "El anticipo", 0)).toEqual({ ok: true, value: 0 });
  });

  it("rechaza vacíos obligatorios, negativos, texto y más de 100 %", () => {
    expect(parsePercentToBp("", "El impuesto", null)).toMatchObject({ ok: false, error: "El impuesto es obligatorio." });
    expect(parsePercentToBp("-5", "El descuento", 0).ok).toBe(false);
    expect(parsePercentToBp("diez", "El descuento", 0).ok).toBe(false);
    expect(parsePercentToBp("1,234", "El descuento", 0).ok).toBe(false);
    expect(parsePercentToBp("101", "El anticipo", 0)).toMatchObject({ ok: false });
  });

  it("vuelve a mostrar puntos básicos como texto de campo", () => {
    expect(bpToPercentInput(1_900)).toBe("19");
    expect(bpToPercentInput(1_250)).toBe("12,5");
  });

  it("usa la fecha de Colombia, no la de UTC", () => {
    // 2026-11-19 02:00 UTC = 2026-11-18 21:00 en Bogotá.
    expect(todayInBogota(new Date("2026-11-19T02:00:00Z"))).toBe("2026-11-18");
  });
});
