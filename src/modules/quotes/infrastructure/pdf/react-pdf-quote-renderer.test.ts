// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { QUOTE_FIXTURE } from "@/app/(protected)/quotes/_lib/test-fixtures";
import type { QuoteDto } from "../../application/dtos/quote.dto";

vi.mock("server-only", () => ({}));

import { DEFAULT_LOGO_PATH, ReactPdfQuoteRenderer } from "./react-pdf-quote-renderer";

const decoder = new TextDecoder("latin1");
const pageCount = (pdf: Uint8Array) => decoder.decode(pdf).match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

/** Cotización larga: 60 conceptos para forzar varias páginas. */
const LONG_QUOTE: QuoteDto = {
  ...QUOTE_FIXTURE,
  lines: Array.from({ length: 60 }, (_, index) => ({
    lineTotalCop: 10_000 * (index + 1),
    moduleId: `m-${index}`,
    name: `Concepto ${index + 1} con un nombre largo para comprobar el ajuste de línea en la tabla`,
    position: index + 1,
    quantity: index + 1,
    unitPriceCop: 10_000,
  })),
};

describe("ReactPdfQuoteRenderer (DECOR-52)", () => {
  it("genera un PDF válido de una página para una cotización corta", async () => {
    const pdf = await new ReactPdfQuoteRenderer(DEFAULT_LOGO_PATH).render(QUOTE_FIXTURE);
    const text = decoder.decode(pdf);

    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pageCount(pdf)).toBe(1);
    expect(text).toContain("/Subtype /Image");
  }, 30_000);

  it("una cotización larga ocupa varias páginas", async () => {
    const pdf = await new ReactPdfQuoteRenderer(DEFAULT_LOGO_PATH).render(LONG_QUOTE);

    expect(pageCount(pdf)).toBeGreaterThan(1);
  }, 30_000);

  it("la misma versión produce el mismo PDF, sin depender de la hora actual", async () => {
    const renderer = new ReactPdfQuoteRenderer(DEFAULT_LOGO_PATH);
    const first = await renderer.render(QUOTE_FIXTURE);
    vi.useFakeTimers({ now: new Date("2030-01-01T00:00:00Z"), toFake: ["Date"] });
    const second = await renderer.render(QUOTE_FIXTURE);
    vi.useRealTimers();

    const withoutId = (pdf: Uint8Array) => decoder.decode(pdf).replace(/\/ID \[[\s\S]*?\]/, "");
    expect(withoutId(second)).toBe(withoutId(first));
    expect(decoder.decode(first)).toContain("D:20261120");
  }, 30_000);

  it("si falta el logo, el PDF sale igual sin imagen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pdf = await new ReactPdfQuoteRenderer("no-existe/logo.png").render(QUOTE_FIXTURE);

    expect(decoder.decode(pdf).startsWith("%PDF-")).toBe(true);
    expect(decoder.decode(pdf)).not.toContain("/Subtype /Image");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  }, 30_000);

  it("renderiza un PublicQuoteDto sin estado ni createdAt (DECOR-56)", async () => {
    const pdf = await new ReactPdfQuoteRenderer(DEFAULT_LOGO_PATH).render({
      client: QUOTE_FIXTURE.client,
      conditions: QUOTE_FIXTURE.conditions,
      event: QUOTE_FIXTURE.event,
      lines: QUOTE_FIXTURE.lines.map(({ lineTotalCop, name, position, quantity, unitPriceCop }) => ({
        lineTotalCop,
        name,
        position,
        quantity,
        unitPriceCop,
      })),
      number: QUOTE_FIXTURE.number,
      terms: QUOTE_FIXTURE.terms,
      totals: QUOTE_FIXTURE.totals,
      validUntil: QUOTE_FIXTURE.validUntil,
      version: QUOTE_FIXTURE.version,
    });

    expect(decoder.decode(pdf).startsWith("%PDF-")).toBe(true);
    expect(pageCount(pdf)).toBe(1);
  }, 30_000);
});
