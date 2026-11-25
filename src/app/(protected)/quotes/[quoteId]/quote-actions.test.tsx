import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import { QUOTE_FIXTURE } from "../_lib/test-fixtures";
import type { QuotesClient } from "../_lib/quotes-client";
import { QuoteActions } from "./quote-actions";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const fakeClient = (createQuoteVersion: QuotesClient["createQuoteVersion"]): QuotesClient => ({
  changeStatus: vi.fn(),
  createQuote: vi.fn(),
  createQuoteVersion,
  createShareLink: vi.fn(),
  getShareLink: vi.fn(),
  listQuotes: vi.fn(),
  revokeShareLink: vi.fn(),
});

const TODAY = "2026-11-23";

describe("QuoteActions (DECOR-51)", () => {
  beforeEach(() => push.mockReset());

  it("permite volver a editar el evento de origen", () => {
    render(<QuoteActions client={fakeClient(vi.fn())} quote={QUOTE_FIXTURE} today={TODAY} />);

    expect(screen.getByRole("link", { name: "Volver a editar el evento" })).toHaveAttribute(
      "href",
      `/packages/${QUOTE_FIXTURE.packageId}`,
    );
  });

  it("actualizar crea una versión nueva con los mismos términos y abre su vista previa", async () => {
    const createQuoteVersion = vi.fn().mockResolvedValue(ok({ id: "q-nueva", version: 3 }));
    render(<QuoteActions client={fakeClient(createQuoteVersion)} quote={QUOTE_FIXTURE} today={TODAY} />);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar cotización" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/quotes/q-nueva"));
    expect(createQuoteVersion).toHaveBeenCalledWith(QUOTE_FIXTURE.id, {
      clientName: "Ana Pérez",
      conditions: "Pago del saldo el día del evento.",
      depositRateBp: 5_000,
      discountRateBp: 1_000,
      taxRateBp: 1_900,
      validUntil: "2026-12-01",
    });
  });

  it("con la vigencia vencida pide una fecha nueva antes de actualizar", async () => {
    const createQuoteVersion = vi.fn().mockResolvedValue(ok({ id: "q-nueva", version: 3 }));
    render(<QuoteActions client={fakeClient(createQuoteVersion)} quote={QUOTE_FIXTURE} today="2026-12-05" />);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar cotización" }));
    const alert = await screen.findByRole("alert");
    const validUntil = screen.getByLabelText(/Nueva vigencia/);
    expect(alert).toHaveTextContent("Elige una vigencia desde hoy en adelante.");
    expect(validUntil).toHaveAttribute("aria-invalid", "true");
    expect(validUntil).toHaveAttribute("aria-describedby", alert.id);
    expect(createQuoteVersion).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Nueva vigencia/), { target: { value: "2026-12-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Actualizar cotización" }));

    await waitFor(() => expect(createQuoteVersion).toHaveBeenCalledTimes(1));
    expect(createQuoteVersion.mock.calls[0][1]).toMatchObject({ validUntil: "2026-12-20" });
  });

  it("muestra el error de la API sin navegar", async () => {
    const createQuoteVersion = vi
      .fn()
      .mockResolvedValue(err({ kind: "invalid", message: "El evento cambió mientras tanto." }));
    render(<QuoteActions client={fakeClient(createQuoteVersion)} quote={QUOTE_FIXTURE} today={TODAY} />);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar cotización" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("El evento cambió mientras tanto.");
    expect(push).not.toHaveBeenCalled();
  });

  it("si el evento se eliminó, no ofrece editar ni actualizar", () => {
    render(<QuoteActions client={fakeClient(vi.fn())} quote={{ ...QUOTE_FIXTURE, packageId: null }} today={TODAY} />);

    expect(screen.queryByRole("link", { name: "Volver a editar el evento" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actualizar cotización" })).not.toBeInTheDocument();
    expect(screen.getByText(/ya no existe/)).toBeInTheDocument();
  });

  it("descarga el PDF de esta versión desde el servidor (DECOR-52)", () => {
    render(<QuoteActions client={fakeClient(vi.fn())} quote={{ ...QUOTE_FIXTURE, packageId: null }} today={TODAY} />);

    const link = screen.getByRole("link", { name: "Descargar PDF" });
    expect(link).toHaveAttribute("href", `/api/quotes/${QUOTE_FIXTURE.id}/pdf`);
    expect(link).toHaveAttribute("download");
  });

  it("imprimir abre el diálogo del navegador", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<QuoteActions client={fakeClient(vi.fn())} quote={QUOTE_FIXTURE} today={TODAY} />);

    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));

    expect(print).toHaveBeenCalledTimes(1);
  });
});
