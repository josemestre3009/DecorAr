import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DuplicatedNotice } from "./duplicated-notice";

describe("DuplicatedNotice (DECOR-43)", () => {
  it("confirma la copia y limpia el parámetro de la URL sin navegar", () => {
    window.history.pushState({}, "", "/packages/pkg-copy?duplicated=1");

    render(<DuplicatedNotice packageId="pkg-copy" />);

    expect(screen.getByRole("status")).toHaveTextContent("Copia creada.");
    expect(screen.getByRole("status")).toHaveTextContent("El original no cambia.");
    expect(window.location.pathname).toBe("/packages/pkg-copy");
    expect(window.location.search).toBe("");
  });

  it("se puede cerrar", () => {
    render(<DuplicatedNotice packageId="pkg-copy" />);

    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
