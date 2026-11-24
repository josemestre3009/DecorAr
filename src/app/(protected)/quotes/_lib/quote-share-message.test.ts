import { describe, expect, it } from "vitest";

import { formatCop, formatEventDate } from "../../packages/_lib/format";
import { buildQuoteShareMessage, buildWhatsAppUrl, type QuoteShareSummary } from "./quote-share-message";

const LINK_URL = "https://decorar.example/c/token-de-ejemplo_123";

const SUMMARY: QuoteShareSummary = {
  clientName: "Ana Pérez",
  number: 12,
  totalCop: 535_500,
  validUntil: "2026-12-01",
  version: 2,
};

describe("buildQuoteShareMessage (DECOR-54)", () => {
  it("incluye cliente, número, versión, total, vigencia y enlace", () => {
    const message = buildQuoteShareMessage(SUMMARY, LINK_URL);

    expect(message).toBe(
      [
        "Hola, Ana Pérez. Te comparto la Cotización N.º 12 · versión 2.",
        `Total: ${formatCop(535_500)}`,
        `Válida hasta: ${formatEventDate("2026-12-01")}`,
        `Puedes verla aquí: ${LINK_URL}`,
      ].join("\n"),
    );
    expect(message).toContain("535.500");
  });

  it("el enlace aparece una sola vez y sin modificar", () => {
    const message = buildQuoteShareMessage(SUMMARY, LINK_URL);

    expect(message.split(LINK_URL)).toHaveLength(2);
  });

  it("sin nombre del cliente saluda sin nombre", () => {
    expect(buildQuoteShareMessage({ ...SUMMARY, clientName: null }, LINK_URL)).toMatch(/^Hola\. Te comparto/);
    expect(buildQuoteShareMessage({ ...SUMMARY, clientName: "   " }, LINK_URL)).toMatch(/^Hola\. Te comparto/);
  });

  it("recorta los espacios del nombre", () => {
    expect(buildQuoteShareMessage({ ...SUMMARY, clientName: "  Ana  " }, LINK_URL)).toMatch(/^Hola, Ana\. /);
  });

  it("omite la vigencia vacía o no interpretable", () => {
    for (const validUntil of [null, "", "no-es-fecha"]) {
      const message = buildQuoteShareMessage({ ...SUMMARY, validUntil }, LINK_URL);

      expect(message).not.toContain("Válida hasta");
      expect(message).toContain(LINK_URL);
    }
  });

  it("omite un total no interpretable", () => {
    const message = buildQuoteShareMessage({ ...SUMMARY, totalCop: Number.NaN }, LINK_URL);

    expect(message).not.toContain("Total");
    expect(message).toContain(LINK_URL);
  });
});

describe("buildWhatsAppUrl (DECOR-54)", () => {
  it("usa wa.me sin número y codifica el mensaje", () => {
    const message = buildQuoteShareMessage(SUMMARY, LINK_URL);
    const whatsAppUrl = buildWhatsAppUrl(message);

    expect(whatsAppUrl.startsWith("https://wa.me/?text=")).toBe(true);
    expect(whatsAppUrl).not.toMatch(/[\s\n]/);
    expect(whatsAppUrl).toContain("%0A");
    expect(new URL(whatsAppUrl).searchParams.get("text")).toBe(message);
  });

  it("codifica tildes, símbolos y caracteres reservados sin perder el enlace", () => {
    const message = "Hola, José & Cía. N.º 3 · $ 1.000 ¿listo? #1\nhttps://x.example/c/a?b=c&d=e";
    const parsed = new URL(buildWhatsAppUrl(message));

    expect(parsed.origin).toBe("https://wa.me");
    expect([...parsed.searchParams.keys()]).toEqual(["text"]);
    expect(parsed.searchParams.get("text")).toBe(message);
  });
});
