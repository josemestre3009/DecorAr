import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AuthFormState } from "../auth-form-state";
import { AuthForm } from "./auth-form";

function submit() {
  fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "ana@correo.com" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreta-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
}

describe("AuthForm", () => {
  it("muestra el formulario con sus campos y el cambio entre login y registro", () => {
    render(<AuthForm action={vi.fn()} mode="login" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Iniciar sesión");
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Regístrate" })).toHaveAttribute("href", "/signup");
  });

  it("tras registrarse muestra la vista para confirmar el correo con el foco en su título", async () => {
    const action = vi.fn(
      async (): Promise<AuthFormState> => ({
        message: "Revisa el correo ana@correo.com y confirma tu cuenta para poder entrar.",
        status: "pending_confirmation",
      }),
    );
    render(<AuthForm action={action} mode="signup" />);

    submit();

    const heading = await screen.findByRole("heading", { level: 1, name: "Revisa tu correo" });
    expect(screen.getByRole("status")).toHaveTextContent("ana@correo.com");
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a iniciar sesión" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Usar otro correo" })).toHaveAttribute("href", "/signup");
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("asocia el error al campo y lo anuncia", async () => {
    const action = vi.fn(
      async (): Promise<AuthFormState> => ({
        email: "ana@correo.com",
        field: "password",
        message: "Escribe tu contraseña.",
        status: "error",
      }),
    );
    render(<AuthForm action={action} mode="signup" />);

    submit();

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Escribe tu contraseña.");
    expect(error).toHaveAttribute("id", "password-error");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("ana@correo.com");
  });
});
