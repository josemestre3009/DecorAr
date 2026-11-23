import { describe, expect, it } from "vitest";

import { applyRateCop, calculateQuote } from "./quote-totals";

const SILLA = { moduleId: "m-silla", name: "Silla", quantity: 10, unitPriceCop: 20_000 };
const ARCO = { moduleId: "m-arco", name: "Arco floral", quantity: 2, unitPriceCop: 150_000 };
const NO_RATES = { depositRateBp: 0, discountRateBp: 0, taxRateBp: 0 };

describe("calculateQuote (DECOR-50)", () => {
  it("calcula el ejemplo Boda Ana: 10 % descuento, 19 % IVA, 50 % anticipo", () => {
    const result = calculateQuote([SILLA, ARCO], {
      depositRateBp: 5_000,
      discountRateBp: 1_000,
      taxRateBp: 1_900,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals).toEqual({
      depositCop: 267_750,
      discountCop: 50_000,
      subtotalCop: 500_000,
      taxCop: 85_500,
      taxableBaseCop: 450_000,
      totalCop: 535_500,
    });
  });

  it("congela cada línea con posición y subtotal propio", () => {
    const result = calculateQuote([SILLA, ARCO], NO_RATES);

    expect(result.ok && result.value.lines).toEqual([
      { ...SILLA, lineTotalCop: 200_000, position: 1 },
      { ...ARCO, lineTotalCop: 300_000, position: 2 },
    ]);
  });

  it("sin descuento, impuesto ni anticipo el total es el subtotal", () => {
    const result = calculateQuote([SILLA], NO_RATES);

    expect(result.ok && result.value.totals).toEqual({
      depositCop: 0,
      discountCop: 0,
      subtotalCop: 200_000,
      taxCop: 0,
      taxableBaseCop: 200_000,
      totalCop: 200_000,
    });
  });

  it("el impuesto se aplica sobre la base después del descuento", () => {
    const result = calculateQuote([SILLA], { depositRateBp: 0, discountRateBp: 5_000, taxRateBp: 1_900 });

    // 200.000 − 100.000 = 100.000 → IVA 19.000 (no 38.000 sobre el subtotal)
    expect(result.ok && result.value.totals.taxCop).toBe(19_000);
    expect(result.ok && result.value.totals.totalCop).toBe(119_000);
  });

  it("descuento del 100 % deja total y anticipo en cero", () => {
    const result = calculateQuote([SILLA], { depositRateBp: 3_000, discountRateBp: 10_000, taxRateBp: 1_900 });

    expect(result.ok && result.value.totals).toMatchObject({ depositCop: 0, taxCop: 0, totalCop: 0 });
  });

  describe("redondeo COP al peso, mitad hacia arriba", () => {
    it("redondea .5 hacia arriba", () => {
      // 1 × 19 % = 0,19 → 0 ; 50 × 1 % = 0,5 → 1 ; 150 × 1 % = 1,5 → 2
      expect(applyRateCop(BigInt(1), 1_900)).toBe(BigInt(0));
      expect(applyRateCop(BigInt(50), 100)).toBe(BigInt(1));
      expect(applyRateCop(BigInt(150), 100)).toBe(BigInt(2));
    });

    it("redondea por debajo de .5 hacia abajo", () => {
      // 149 × 1 % = 1,49 → 1
      expect(applyRateCop(BigInt(149), 100)).toBe(BigInt(1));
    });

    it("produce siempre montos enteros con tasas que generan fracciones", () => {
      const result = calculateQuote(
        [{ moduleId: "m", name: "Mantel", quantity: 3, unitPriceCop: 33_333 }],
        { depositRateBp: 3_333, discountRateBp: 750, taxRateBp: 1_900 },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { totals } = result.value;
      // subtotal 99.999; descuento 7.499,925 → 7.500; base 92.499;
      // IVA 17.574,81 → 17.575; total 110.074; anticipo 36.687,66 → 36.688
      expect(totals).toEqual({
        depositCop: 36_688,
        discountCop: 7_500,
        subtotalCop: 99_999,
        taxCop: 17_575,
        taxableBaseCop: 92_499,
        totalCop: 110_074,
      });
      for (const value of Object.values(totals)) expect(Number.isInteger(value)).toBe(true);
    });
  });

  describe("rechaza valores inválidos", () => {
    it("paquete vacío", () => {
      const result = calculateQuote([], NO_RATES);
      expect(!result.ok && result.error.code).toBe("quote.empty_package");
    });

    it.each([
      [{ ...SILLA, quantity: 0 }],
      [{ ...SILLA, quantity: -1 }],
      [{ ...SILLA, quantity: 1.5 }],
      [{ ...SILLA, unitPriceCop: -1 }],
      [{ ...SILLA, unitPriceCop: 10.5 }],
      [{ ...SILLA, name: "  " }],
    ])("línea inválida %o", (line) => {
      const result = calculateQuote([line], NO_RATES);
      expect(!result.ok && result.error.code).toBe("quote.invalid_line");
    });

    it.each([
      [{ ...NO_RATES, discountRateBp: -1 }, "quote.invalid_discount"],
      [{ ...NO_RATES, discountRateBp: 10_001 }, "quote.invalid_discount"],
      [{ ...NO_RATES, taxRateBp: 19.5 }, "quote.invalid_tax"],
      [{ ...NO_RATES, depositRateBp: 20_000 }, "quote.invalid_deposit"],
    ])("tasa inválida %o", (rates, code) => {
      const result = calculateQuote([SILLA], rates);
      expect(!result.ok && result.error.code).toBe(code);
    });

    it("total fuera del rango seguro", () => {
      const result = calculateQuote(
        [{ ...SILLA, quantity: 1_000_000, unitPriceCop: Number.MAX_SAFE_INTEGER }],
        NO_RATES,
      );
      expect(!result.ok && result.error.code).toBe("quote.total_overflow");
    });
  });
});
