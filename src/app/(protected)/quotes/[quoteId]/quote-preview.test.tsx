import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QUOTE_FIXTURE } from "../_lib/test-fixtures";
import { QuotePreview } from "./quote-preview";

function amount(text: string) {
  // Intl es-CO separa "$" y la cifra con un espacio duro.
  return text.replace(/ /g, " ");
}

function totalRow(label: RegExp) {
  const term = screen.getByText(label, { selector: "dt" });
  return amount(term.parentElement?.querySelector("dd")?.textContent ?? "");
}

describe("QuotePreview (DECOR-51)", () => {
  it("muestra cliente, evento, vigencia y estado guardados", () => {
    render(<QuotePreview quote={QUOTE_FIXTURE} />);

    expect(screen.getByRole("article", { name: "Cotización N.º 12 · versión 2" })).toBeInTheDocument();
    expect(screen.getByText("Borrador")).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Boda de Ana")).toBeInTheDocument();
    expect(screen.getByText("Hacienda El Prado")).toBeInTheDocument();
    expect(screen.getByText("Boda")).toBeInTheDocument();
    const validUntil = screen.getByText((_, el) => el?.tagName === "TIME");
    expect(validUntil).toHaveAttribute("dateTime", "2026-12-01");
    expect(validUntil.textContent).toMatch(/2026/);
    expect(screen.getByText("Pago del saldo el día del evento.")).toBeInTheDocument();
  });

  it("pinta una tabla accesible con los precios congelados en COP", () => {
    render(<QuotePreview quote={QUOTE_FIXTURE} />);

    const table = screen.getByRole("table", { name: /Conceptos de la cotización/ });
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Concepto", "Cantidad", "Precio unitario", "Subtotal"]);

    const arco = within(table).getByRole("row", { name: /Arco floral/ });
    const cells = within(arco).getAllByRole("cell").map((td) => amount(td.textContent ?? ""));
    expect(cells).toEqual(["2", "$ 150.000", "$ 300.000"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("muestra los totales del servidor y las tasas en porcentaje", () => {
    render(<QuotePreview quote={QUOTE_FIXTURE} />);

    expect(totalRow(/^Subtotal$/)).toBe("$ 500.000");
    expect(totalRow(/Descuento \(10 %\)/)).toBe("− $ 50.000");
    expect(totalRow(/Base gravable/)).toBe("$ 450.000");
    expect(totalRow(/Impuestos \(19 %\)/)).toBe("$ 85.500");
    expect(totalRow(/^Total$/)).toBe("$ 535.500");
    expect(totalRow(/Anticipo \(50 % del total\)/)).toBe("$ 267.750");
  });

  it("indica datos faltantes y una cotización sin conceptos", () => {
    render(
      <QuotePreview
        quote={{
          ...QUOTE_FIXTURE,
          client: { name: null },
          conditions: null,
          event: { date: null, name: "Evento", type: null, venue: null },
          lines: [],
        }}
      />,
    );

    expect(screen.getAllByText("Sin definir")).toHaveLength(4);
    expect(screen.getByText("Esta cotización no tiene conceptos.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Condiciones")).not.toBeInTheDocument();
  });
});
