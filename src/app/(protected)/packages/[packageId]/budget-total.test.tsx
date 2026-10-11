import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BudgetTotal } from "./budget-total";
import { SpaceSummary } from "./space-summary";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const visible = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("BudgetTotal (DECOR-22)", () => {
  beforeEach(() => refresh.mockReset());

  it("muestra el total confirmado por Presupuesto y su versión", () => {
    render(
      <BudgetTotal
        budget={{ packageVersion: 3, status: "confirmed", totalCop: 1050000 }}
        packageVersion={3}
      />,
    );

    expect(visible(screen.getByRole("status").textContent)).toBe("Total confirmado$ 1.050.000");
    expect(screen.getByText(/versión 3 del paquete/)).toBeInTheDocument();
  });

  it("avisa cuando el total es de una versión anterior y permite actualizar", () => {
    render(
      <BudgetTotal
        budget={{ packageVersion: 2, status: "confirmed", totalCop: 450000 }}
        packageVersion={3}
      />,
    );

    expect(screen.getByText(/se está recalculando/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar total" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("sin presupuesto calculado (404) lo dice sin sumar en el cliente", () => {
    render(<BudgetTotal budget={{ status: "pending" }} packageVersion={1} />);

    expect(screen.getByRole("status")).toHaveTextContent("Presupuesto aún no calculado");
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("si falla la lectura muestra el error y permite reintentar", () => {
    render(<BudgetTotal budget={{ status: "error" }} packageVersion={1} />);

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos obtener el presupuesto.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("SpaceSummary (DECOR-22)", () => {
  it("muestra tipo descriptivo, capacidad, área usada y restante del servidor", () => {
    render(<SpaceSummary detail={{ capacityM2: 30, remainingM2: 14, spaceType: "aireLibre", usedM2: 16 }} />);

    const values = screen.getAllByRole("definition").map((dd) => visible(dd.textContent));
    expect(values).toEqual(["Aire libre (parque o playa)", "30 m²", "16 m²", "14 m²"]);
  });
});
