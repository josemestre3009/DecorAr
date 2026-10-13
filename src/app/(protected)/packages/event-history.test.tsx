import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PackageSummary } from "@/modules/packages/application/ports/package-reader.port";

import { EventHistory } from "./event-history";

const packages = Array.from({ length: 7 }, (_, index): PackageSummary => ({
  capacityM2: null,
  clientName: null,
  eventDate: null,
  eventType: null,
  id: `pkg-${index + 1}`,
  name: `Evento ${index + 1}`,
  spaceType: null,
  spatial: { availableM2: null, requiredM2: 0, status: "pending" },
  updatedAt: "2026-10-12T15:00:00Z",
  venue: null,
}));

describe("EventHistory", () => {
  it("muestra cuatro eventos por página y permite navegar", () => {
    render(<EventHistory packages={packages} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Evento 1")).toBeInTheDocument();
    expect(screen.queryByText("Evento 5")).not.toBeInTheDocument();
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Evento 5")).toBeInTheDocument();
    expect(screen.queryByText("Evento 1")).not.toBeInTheDocument();
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });

  it("no muestra controles para una sola página", () => {
    render(<EventHistory packages={packages.slice(0, 2)} />);

    expect(screen.queryByRole("navigation", { name: "Paginación de eventos" })).not.toBeInTheDocument();
  });

  it("vuelve a la última página válida cuando la lista se reduce", () => {
    const { rerender } = render(<EventHistory packages={packages} />);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    rerender(<EventHistory packages={packages.slice(0, 3)} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Evento 1")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Paginación de eventos" })).not.toBeInTheDocument();
  });
});
