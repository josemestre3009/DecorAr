import type { QuoteDto } from "@/modules/quotes/application/dtos/quote.dto";

/**
 * Cotización de prueba (solo tests, DECOR-51). Totales como los calcula el
 * servidor: 500.000 − 10 % = 450.000 + 19 % IVA = 535.500; anticipo 50 %.
 */
export const QUOTE_FIXTURE: QuoteDto = {
  client: { name: "Ana Pérez" },
  conditions: "Pago del saldo el día del evento.",
  createdAt: "2026-11-20T15:00:00.000Z",
  currency: "COP",
  event: { date: "2026-12-12", name: "Boda de Ana", type: "Boda", venue: "Hacienda El Prado" },
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  lines: [
    { lineTotalCop: 300_000, moduleId: "m-arco", name: "Arco floral", position: 1, quantity: 2, unitPriceCop: 150_000 },
    { lineTotalCop: 200_000, moduleId: "m-silla", name: "Silla", position: 2, quantity: 10, unitPriceCop: 20_000 },
  ],
  number: 12,
  packageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sourcePackageVersion: 4,
  status: "draft",
  statusChangedAt: "2026-11-20T15:00:00.000Z",
  terms: { depositRateBp: 5_000, discountRateBp: 1_000, taxRateBp: 1_900 },
  totals: {
    depositCop: 267_750,
    discountCop: 50_000,
    subtotalCop: 500_000,
    taxCop: 85_500,
    taxableBaseCop: 450_000,
    totalCop: 535_500,
  },
  validUntil: "2026-12-01",
  version: 2,
};
