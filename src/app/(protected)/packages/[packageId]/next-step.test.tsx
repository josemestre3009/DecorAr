import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NextStep } from "./next-step";

describe("NextStep (DECOR-49)", () => {
  it("sin elementos lleva al catálogo", () => {
    render(<NextStep unitCount={0} />);

    expect(screen.getByRole("heading", { name: "Agrega los elementos de tu evento" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al catálogo" })).toHaveAttribute("href", "#catalogo");
    expect(screen.queryByRole("link", { name: "Crear la cotización" })).toBeNull();
  });

  it("con elementos invita a verlos en 3D y a cotizar", () => {
    render(<NextStep unitCount={3} />);

    expect(screen.getByRole("heading", { name: "Mira tu montaje y crea la cotización" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear la cotización" })).toHaveAttribute("href", "#cotizacion");
    expect(screen.getByRole("link", { name: "Ver los elementos en 3D" })).toHaveAttribute("href", "#montaje");
  });
});
