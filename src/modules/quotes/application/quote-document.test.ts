import { describe, expect, it } from "vitest";

import { formatCop, formatEventDate } from "@/app/(protected)/packages/_lib/format";
import { formatRateBp, quoteTitle } from "@/app/(protected)/quotes/_lib/quote-format";
import { QUOTE_FIXTURE } from "@/app/(protected)/quotes/_lib/test-fixtures";

import { buildQuoteDocument, quoteFileName } from "./quote-document";

/** Mismo texto que la vista previa, con los ajustes de las fuentes del PDF. */
const asPdfText = (text: string) => text.replace(/[\u202F\u2009]/g, "\u00A0").replace(/\u2212/g, "-");

describe("buildQuoteDocument (DECOR-52)", () => {
  it("coincide con la vista previa: título, cliente, evento, vigencia y estado", () => {
    const document = buildQuoteDocument(QUOTE_FIXTURE);

    expect(document.title).toBe(quoteTitle(12, 2));
    expect(document.statusLabel).toBe("Borrador");
    expect(document.validUntil).toBe(asPdfText(formatEventDate("2026-12-01")!));
    expect(document.issuedOn).toBe(asPdfText(formatEventDate("2026-11-20")!));
    expect(document.facts).toEqual([
      { label: "Cliente", value: "Ana Pérez" },
      { label: "Evento", value: "Boda de Ana" },
      { label: "Fecha", value: asPdfText(formatEventDate("2026-12-12")!) },
      { label: "Lugar", value: "Hacienda El Prado" },
      { label: "Tipo de evento", value: "Boda" },
    ]);
    expect(document.conditions).toBe("Pago del saldo el día del evento.");
  });

  it("las filas y los totales son los congelados por el servidor, en COP", () => {
    const document = buildQuoteDocument(QUOTE_FIXTURE);

    expect(document.lines).toEqual([
      {
        concept: "Arco floral",
        key: "1",
        quantity: "2",
        subtotal: asPdfText(formatCop(300_000)),
        unitPrice: asPdfText(formatCop(150_000)),
      },
      {
        concept: "Silla",
        key: "2",
        quantity: "10",
        subtotal: asPdfText(formatCop(200_000)),
        unitPrice: asPdfText(formatCop(20_000)),
      },
    ]);
    expect(document.totals).toEqual([
      { emphasis: false, label: "Subtotal", value: asPdfText(formatCop(500_000)) },
      { emphasis: false, label: `Descuento (${asPdfText(formatRateBp(1_000))})`, value: `- ${asPdfText(formatCop(50_000))}` },
      { emphasis: false, label: "Base gravable", value: asPdfText(formatCop(450_000)) },
      { emphasis: false, label: `Impuestos (${asPdfText(formatRateBp(1_900))})`, value: asPdfText(formatCop(85_500)) },
      { emphasis: true, label: "Total", value: asPdfText(formatCop(535_500)) },
      {
        emphasis: false,
        label: `Anticipo (${asPdfText(formatRateBp(5_000))} del total)`,
        value: asPdfText(formatCop(267_750)),
      },
    ]);
  });

  it("sólo usa caracteres que las fuentes estándar del PDF pueden dibujar", () => {
    const document = buildQuoteDocument(QUOTE_FIXTURE);
    const text = JSON.stringify(document);

    expect(text).not.toMatch(/[\u202F\u2009\u2212]/);
  });

  it("datos faltantes como 'Sin definir', sin condiciones y sin descuento", () => {
    const document = buildQuoteDocument({
      ...QUOTE_FIXTURE,
      client: { name: null },
      conditions: "   ",
      event: { date: null, name: "Evento", type: null, venue: null },
      lines: [],
      terms: { ...QUOTE_FIXTURE.terms, discountRateBp: 0 },
      totals: { ...QUOTE_FIXTURE.totals, discountCop: 0 },
    });

    expect(document.facts.filter((fact) => fact.value === "Sin definir")).toHaveLength(4);
    expect(document.conditions).toBeNull();
    expect(document.lines).toEqual([]);
    expect(document.totals[1]).toEqual({ emphasis: false, label: "Descuento (0 %)", value: asPdfText(formatCop(0)) });
  });

  it("una versión histórica produce siempre el mismo contenido", () => {
    const copy = structuredClone(QUOTE_FIXTURE);

    expect(buildQuoteDocument(copy)).toEqual(buildQuoteDocument(QUOTE_FIXTURE));
    expect(buildQuoteDocument(QUOTE_FIXTURE)).toEqual(buildQuoteDocument(QUOTE_FIXTURE));
  });

  it("nombre de archivo ASCII con número y versión", () => {
    expect(quoteFileName(QUOTE_FIXTURE)).toBe("cotizacion-12-v2.pdf");
    expect(buildQuoteDocument(QUOTE_FIXTURE).fileName).toBe("cotizacion-12-v2.pdf");
  });
});
