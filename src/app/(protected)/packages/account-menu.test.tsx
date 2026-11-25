import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "./account-menu";

const signOutAction = vi.fn(async () => {});

describe("AccountMenu (rediseño visual)", () => {
  it("muestra la sesión y Cerrar sesión solo al abrir el menú", () => {
    render(<AccountMenu email="ana@example.com" signOutAction={signOutAction} />);

    const trigger = screen.getByRole("button", { name: "Tu cuenta" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Sesión activa: ana@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toHaveAttribute("type", "submit");
  });

  it("Escape cierra el menú y devuelve el foco al botón", () => {
    render(<AccountMenu email="ana@example.com" signOutAction={signOutAction} />);

    const trigger = screen.getByRole("button", { name: "Tu cuenta" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});
