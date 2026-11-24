import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { QuotesClient } from "../../quotes/_lib/quotes-client";
import { CreateQuoteForm } from "./create-quote-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const fakeClient = (createQuote: QuotesClient["createQuote"]): QuotesClient => ({
  createQuote,
  createQuoteVersion: vi.fn(),
  createShareLink: vi.fn(),
  getShareLink: vi.fn(),
  revokeShareLink: vi.fn(),
});

const TODAY = "2026-11-23";

function openForm(createQuote: QuotesClient["createQuote"] = vi.fn()) {
  render(<CreateQuoteForm client={fakeClient(createQuote)} clientName="Ana" packageId="pkg-1" today={TODAY} />);
  const toggle = screen.getByRole("button", { name: "Generar cotización" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
}

describe("CreateQuoteForm (DECOR-51)", () => {
  beforeEach(() => push.mockReset());

  it("propone el cliente del evento, IVA 19 % y descuento/anticipo en 0", () => {
    openForm();

    expect(screen.getByRole("form", { name: "Generar cotización" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cliente (opcional)")).toHaveValue("Ana");
    expect(screen.getByLabelText("Impuestos (IVA) %")).toHaveValue("19");
    expect(screen.getByLabelText("Descuento %")).toHaveValue("0");
    expect(screen.getByLabelText("Anticipo % (sobre el total)")).toHaveValue("0");
    expect(screen.getByLabelText("Válida hasta")).toHaveAttribute("min", TODAY);
  });

  it("valida vigencia y porcentajes antes de llamar a la API", async () => {
    const createQuote = vi.fn();
    openForm(createQuote);

    fireEvent.change(screen.getByLabelText("Impuestos (IVA) %"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Descuento %"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Generar y revisar" }));

    expect(await screen.findByText("La vigencia es obligatoria.")).toBeInTheDocument();
    expect(screen.getByText("El impuesto es obligatorio.")).toBeInTheDocument();
    expect(screen.getByText("El descuento no puede superar el 100 %.")).toBeInTheDocument();
    expect(screen.getByLabelText("Válida hasta")).toHaveAttribute("aria-invalid", "true");
    expect(createQuote).not.toHaveBeenCalled();
  });

  it("envía los términos en puntos básicos y abre la vista previa", async () => {
    const createQuote = vi.fn().mockResolvedValue(ok({ id: "q-1", version: 1 }));
    openForm(createQuote);

    fireEvent.change(screen.getByLabelText("Válida hasta"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Descuento %"), { target: { value: "12,5" } });
    fireEvent.change(screen.getByLabelText("Anticipo % (sobre el total)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Condiciones (opcional)"), { target: { value: "  Pago al final.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Generar y revisar" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/quotes/q-1"));
    expect(createQuote).toHaveBeenCalledWith("pkg-1", {
      clientName: "Ana",
      conditions: "Pago al final.",
      depositRateBp: 5_000,
      discountRateBp: 1_250,
      taxRateBp: 1_900,
      validUntil: "2026-12-01",
    });
  });

  it("muestra el error de la API y no navega", async () => {
    const createQuote = vi
      .fn()
      .mockResolvedValue(err({ kind: "invalid", message: "El evento no tiene módulos para cotizar." }));
    openForm(createQuote);

    fireEvent.change(screen.getByLabelText("Válida hasta"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Generar y revisar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("El evento no tiene módulos para cotizar.");
    expect(push).not.toHaveBeenCalled();
  });

  it("sin sesión vuelve a /login", async () => {
    const createQuote = vi.fn().mockResolvedValue(err({ kind: "unauthorized", message: "x" }));
    openForm(createQuote);

    fireEvent.change(screen.getByLabelText("Válida hasta"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Generar y revisar" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
