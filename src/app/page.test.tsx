import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("identifica DecorAR y su propósito", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Imagina el espacio/);
    expect(screen.getByText(/visualiza cada elemento a escala real/i)).toBeVisible();
  });

  it("lleva a crear el paquete desde la llamada a la acción principal", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "Crear mi paquete" })).toHaveAttribute(
      "href",
      "/packages",
    );
  });
});
