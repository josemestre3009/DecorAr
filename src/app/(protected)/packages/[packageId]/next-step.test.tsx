import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NextStep } from "./next-step";

describe("NextStep (DECOR-49, secciones del rediseño)", () => {
  it("sin elementos lleva a la sección del catálogo", () => {
    render(<NextStep packageId="pkg-1" unitCount={0} />);

    expect(screen.getByRole("heading", { name: "Agrega los elementos de tu evento" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al catálogo" })).toHaveAttribute("href", "/packages/pkg-1?seccion=catalogo");
    expect(screen.queryByRole("link", { name: "Crear la cotización" })).toBeNull();
  });

  it("con elementos invita a cotizar y a verlos en 3D", () => {
    render(<NextStep packageId="pkg 1" unitCount={3} />);

    expect(screen.getByRole("heading", { name: "Crea la cotización" })).toBeInTheDocument();
    expect(screen.getByText(/Ya tienes 3 elementos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear la cotización" })).toHaveAttribute(
      "href",
      "/packages/pkg%201?seccion=cotizar",
    );
    expect(screen.getByRole("link", { name: "Ver los elementos en 3D" })).toHaveAttribute(
      "href",
      "/packages/pkg%201?seccion=catalogo",
    );
  });

  it("usa singular con un solo elemento", () => {
    render(<NextStep packageId="pkg-1" unitCount={1} />);

    expect(screen.getByText(/Ya tienes 1 elemento\./)).toBeInTheDocument();
  });
});
