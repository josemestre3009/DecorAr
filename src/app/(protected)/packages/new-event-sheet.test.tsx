import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PackagesClient } from "./_lib/packages-client";
import { NewEventSheet } from "./new-event-sheet";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const client = { mode: "live" } as unknown as PackagesClient;

describe("NewEventSheet (rediseño visual)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("el formulario no ocupa la pantalla: aparece al abrir la hoja", () => {
    render(<NewEventSheet client={client} />);

    expect(screen.queryByRole("form", { name: "Crear evento" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo evento" }));

    expect(screen.getByRole("dialog", { name: "Nuevo evento" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Crear evento" })).toBeInTheDocument();
    // El nombre es lo único obligatorio: el foco empieza ahí.
    expect(screen.getByLabelText("Nombre del evento")).toHaveFocus();
  });

  it("Cerrar oculta la hoja y devuelve el foco al botón que la abrió", () => {
    vi.useFakeTimers();
    render(<NewEventSheet client={client} label="Crear tu primer evento" variant="secondary" />);

    const trigger = screen.getByRole("button", { name: "Crear tu primer evento" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
