import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FLOW_STEPS, flowStepHref, FlowSteps } from "./flow-steps";

describe("FlowSteps (DECOR-49)", () => {
  it("muestra los cinco pasos del recorrido en orden", () => {
    render(<FlowSteps current="evento" />);

    const nav = screen.getByRole("navigation", { name: "Pasos para preparar tu evento" });
    expect(within(nav).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "1Evento",
      "2Objetos",
      "3Montaje 3D",
      "4Cotización",
      "5Compartir",
    ]);
  });

  it("marca el paso actual con aria-current y sin enlace", () => {
    render(<FlowSteps current="cotizacion" packageId="pkg-1" />);

    const current = screen.getByText("Cotización").closest("[aria-current]");
    expect(current).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("link", { name: "Cotización" })).toBeNull();
  });

  it("con evento, los pasos llevan a su sección del configurador", () => {
    render(<FlowSteps current="cotizacion" packageId="pkg 1" />);

    expect(screen.getByRole("link", { name: "Evento" })).toHaveAttribute("href", "/packages/pkg%201#evento");
    expect(screen.getByRole("link", { name: "Objetos" })).toHaveAttribute("href", "/packages/pkg%201#objetos");
    expect(screen.getByRole("link", { name: "Montaje 3D" })).toHaveAttribute("href", "/packages/pkg%201#montaje");
    // Sin cotización abierta, "Compartir" todavía no tiene a dónde llevar.
    expect(screen.queryByRole("link", { name: "Compartir" })).toBeNull();
  });

  it("con cotización, Compartir lleva a su sección", () => {
    render(<FlowSteps current="cotizacion" packageId="pkg-1" quoteId="q-1" />);

    expect(screen.getByRole("link", { name: "Compartir" })).toHaveAttribute("href", "/quotes/q-1#compartir");
  });

  it("sin evento no hay enlaces", () => {
    render(<FlowSteps current="evento" />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("los pasos anteriores quedan como hechos y los siguientes como pendientes", () => {
    const { container } = render(<FlowSteps current="montaje" packageId="pkg-1" />);

    const states = [...container.querySelectorAll("li")].map((item) => item.className);
    expect(states).toEqual([
      "flow-step flow-step-done",
      "flow-step flow-step-done",
      "flow-step flow-step-current",
      "flow-step flow-step-upcoming",
      "flow-step flow-step-upcoming",
    ]);
  });

  it("resume el paso actual para pantallas angostas, oculto a lectores de pantalla", () => {
    const { container } = render(<FlowSteps current="cotizacion" packageId="pkg-1" />);

    const caption = container.querySelector(".flow-steps-caption");
    expect(caption).toHaveTextContent("Paso 4 de 5 · Cotización");
    expect(caption).toHaveAttribute("aria-hidden", "true");
  });

  it("flowStepHref no inventa rutas sin datos", () => {
    for (const step of FLOW_STEPS) {
      expect(flowStepHref(step.id, null, null)).toBeNull();
    }
  });
});
