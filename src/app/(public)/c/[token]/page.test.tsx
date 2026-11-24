import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/shared/domain/domain-error";
import { err, ok } from "@/shared/domain/result";

const { notFoundMock, depsMock } = vi.hoisted(() => ({
  depsMock: { getSharedQuote: { execute: vi.fn() } },
  notFoundMock: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/composition/server", () => ({
  createSharedQuoteQueryDependencies: vi.fn(() => depsMock),
}));

const { default: SharedQuotePage } = await import("./page");

const PUBLIC_QUOTE = {
  client: { name: "Ana Pérez" },
  conditions: null,
  currency: "COP" as const,
  event: { date: "2026-12-12", name: "Boda de Ana", type: "Boda", venue: "Hacienda El Prado" },
  lines: [{ lineTotalCop: 300_000, name: "Arco floral", position: 1, quantity: 2, unitPriceCop: 150_000 }],
  number: 12,
  terms: { depositRateBp: 5_000, discountRateBp: 1_000, taxRateBp: 1_900 },
  totals: { depositCop: 150_000, discountCop: 30_000, subtotalCop: 300_000, taxCop: 51_300, taxableBaseCop: 270_000, totalCop: 321_300 },
  validUntil: "2026-12-01",
  version: 2,
};

describe("SharedQuotePage (DECOR-53)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("muestra la cotización compartida sin su estado", async () => {
    depsMock.getSharedQuote.execute.mockResolvedValue(ok(PUBLIC_QUOTE));

    const page = await SharedQuotePage({ params: Promise.resolve({ token: "token-valido" }) });
    render(page);

    expect(depsMock.getSharedQuote.execute).toHaveBeenCalledWith("token-valido");
    expect(screen.getByRole("article", { name: "Cotización N.º 12 · versión 2" })).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.queryByText("Borrador")).not.toBeInTheDocument();
    expect(screen.queryByText("Enviada")).not.toBeInTheDocument();
  });

  it("un token inválido, vencido o revocado responde 404", async () => {
    depsMock.getSharedQuote.execute.mockResolvedValue(
      err(new DomainError("quote.share_link_not_found", "Este enlace no está disponible.")),
    );

    await expect(
      SharedQuotePage({ params: Promise.resolve({ token: "cualquiera" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("un fallo inesperado también responde 404, sin detalle", async () => {
    depsMock.getSharedQuote.execute.mockResolvedValue(err(new DomainError("quote.persistence_error", "detalle interno")));

    await expect(
      SharedQuotePage({ params: Promise.resolve({ token: "cualquiera" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[SharedQuotePage]"), "quote.persistence_error");
  });
});
