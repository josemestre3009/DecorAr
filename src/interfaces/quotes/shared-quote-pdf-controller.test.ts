// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { QUOTE_FIXTURE } from "@/app/(protected)/quotes/_lib/test-fixtures";
import type { PublicQuoteDto } from "@/modules/quotes/application/dtos/quote.dto";
import { DomainError } from "@/shared/domain/domain-error";
import { err, ok } from "@/shared/domain/result";

import { SharedQuotePdfController } from "./shared-quote-pdf-controller";

const PUBLIC_QUOTE: PublicQuoteDto = {
  client: QUOTE_FIXTURE.client,
  conditions: QUOTE_FIXTURE.conditions,
  currency: QUOTE_FIXTURE.currency,
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
};

function fakeLogger() {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe("SharedQuotePdfController (DECOR-56)", () => {
  it("devuelve el PDF con cabeceras anti-caché y attachment para un token válido", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const render = vi.fn().mockResolvedValue(pdfBytes);
    const execute = vi.fn().mockResolvedValue(ok(PUBLIC_QUOTE));
    const controller = new SharedQuotePdfController({
      getSharedQuote: { execute },
      logger: fakeLogger(),
      pdfRenderer: { render },
    });

    const response = await controller.handleGetPdf(new Request("http://localhost/api/c/tok/pdf"), "tok");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="cotizacion-12-v2.pdf"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(render).toHaveBeenCalledWith(PUBLIC_QUOTE);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes);
  });

  it("responde 404 uniforme cuando el token no es válido, expiró o fue revocado", async () => {
    const render = vi.fn();
    const execute = vi
      .fn()
      .mockResolvedValue(err(new DomainError("quote.share_link_not_found", "Este enlace no está disponible.")));
    const controller = new SharedQuotePdfController({
      getSharedQuote: { execute },
      logger: fakeLogger(),
      pdfRenderer: { render },
    });

    const response = await controller.handleGetPdf(new Request("http://localhost/api/c/bad/pdf"), "bad");

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(render).not.toHaveBeenCalled();
  });

  it("responde 500 y registra el fallo con el logger inyectado, sin el token", async () => {
    const logger = fakeLogger();
    const controller = new SharedQuotePdfController({
      getSharedQuote: { execute: vi.fn().mockResolvedValue(ok(PUBLIC_QUOTE)) },
      logger,
      pdfRenderer: { render: vi.fn().mockRejectedValue(new Error("render roto")) },
    });

    const response = await controller.handleGetPdf(new Request("http://localhost/api/c/tok-secreto/pdf"), "tok-secreto");

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(logger.error).toHaveBeenCalledWith(
      "shared_quote_pdf.unexpected_error",
      expect.objectContaining({ component: "SharedQuotePdfController.getPdf" }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("tok-secreto");
  });
});
