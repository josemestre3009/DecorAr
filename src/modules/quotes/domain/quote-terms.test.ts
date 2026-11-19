import { describe, expect, it } from "vitest";

import { isIsoDate, validarTerminosCotizacion } from "./quote-terms";

const TODAY = "2026-11-18";
const BASE = { taxRateBp: 1_900, validUntil: "2026-12-01" };

describe("validarTerminosCotizacion (DECOR-50)", () => {
  it("acepta términos completos y recorta textos", () => {
    const result = validarTerminosCotizacion(
      {
        clientName: "  Ana Pérez ",
        conditions: " 50 % al firmar ",
        depositRateBp: 5_000,
        discountRateBp: 1_000,
        taxRateBp: 1_900,
        validUntil: "2026-12-01",
      },
      TODAY,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        clientName: "Ana Pérez",
        conditions: "50 % al firmar",
        depositRateBp: 5_000,
        discountRateBp: 1_000,
        taxRateBp: 1_900,
        validUntil: "2026-12-01",
      },
    });
  });

  it("descuento y anticipo valen 0 si se omiten; textos vacíos quedan en null", () => {
    const result = validarTerminosCotizacion({ ...BASE, clientName: "  ", conditions: "" }, TODAY);

    expect(result.ok && result.value).toMatchObject({
      clientName: null,
      conditions: null,
      depositRateBp: 0,
      discountRateBp: 0,
    });
  });

  it("acepta vigencia igual a hoy", () => {
    expect(validarTerminosCotizacion({ ...BASE, validUntil: TODAY }, TODAY).ok).toBe(true);
  });

  it.each([
    [{ ...BASE, validUntil: undefined }, "quote.invalid_valid_until"],
    [{ ...BASE, validUntil: "2026-02-30" }, "quote.invalid_valid_until"],
    [{ ...BASE, validUntil: "01/12/2026" }, "quote.invalid_valid_until"],
    [{ ...BASE, validUntil: "2026-11-17" }, "quote.invalid_valid_until"],
    [{ validUntil: "2026-12-01" }, "quote.invalid_tax"],
    [{ ...BASE, taxRateBp: "1900" }, "quote.invalid_tax"],
    [{ ...BASE, discountRateBp: -5 }, "quote.invalid_discount"],
    [{ ...BASE, discountRateBp: 12.5 }, "quote.invalid_discount"],
    [{ ...BASE, depositRateBp: 10_001 }, "quote.invalid_deposit"],
    [{ ...BASE, conditions: 42 }, "quote.invalid_conditions"],
    [{ ...BASE, conditions: "x".repeat(2001) }, "quote.invalid_conditions"],
    [{ ...BASE, clientName: "x".repeat(121) }, "quote.invalid_client_name"],
  ])("rechaza %o con %s", (input, code) => {
    const result = validarTerminosCotizacion(input, TODAY);
    expect(!result.ok && result.error.code).toBe(code);
  });

  it("isIsoDate distingue fechas reales", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
  });
});
