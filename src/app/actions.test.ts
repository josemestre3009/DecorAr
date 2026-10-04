import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "../shared/domain/result";

const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: {
    currentUser: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
  },
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/composition/server", () => ({
  createSessionDependencies: vi.fn(async () => ({ auth: authMock })),
}));

const { initialAuthFormState } = await import("./auth-form-state");
const { signInAction, signOutAction, signUpAction } = await import("./actions");

function credentials(email = "persona@example.com", password = "secreto") {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);

  return formData;
}

describe("Server Actions de autenticación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envía al caso de uso el correo y la contraseña del formulario sin transformarlos", async () => {
    authMock.signIn.mockResolvedValue(ok({ email: "persona@example.com", id: "user-1" }));

    await signInAction(initialAuthFormState, credentials(" Persona@Example.com ", "secreto"));

    expect(authMock.signIn).toHaveBeenCalledWith({
      email: " Persona@Example.com ",
      password: "secreto",
    });
  });

  it("redirige a /packages tras un registro confirmado", async () => {
    authMock.signUp.mockResolvedValue(ok({ kind: "confirmed" }));

    await signUpAction(initialAuthFormState, credentials());

    expect(redirectMock).toHaveBeenCalledWith("/packages");
  });

  it("muestra el estado pendiente de confirmación con el correo normalizado", async () => {
    authMock.signUp.mockResolvedValue(
      ok({ kind: "pending_confirmation", email: "persona@example.com" }),
    );

    const state = await signUpAction(initialAuthFormState, credentials("PERSONA@example.com"));

    expect(state.status).toBe("pending_confirmation");
    expect(state.message).toContain("persona@example.com");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("devuelve el error con su campo en lugar de redirigir", async () => {
    authMock.signUp.mockResolvedValue(
      err({
        code: "email_taken",
        field: "email",
        message: "Ya existe una cuenta con ese correo. Intenta iniciar sesión.",
      }),
    );

    const state = await signUpAction(initialAuthFormState, credentials());

    expect(state).toEqual({
      status: "error",
      message: "Ya existe una cuenta con ese correo. Intenta iniciar sesión.",
      field: "email",
      email: "persona@example.com",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirige a /packages tras iniciar sesión", async () => {
    authMock.signIn.mockResolvedValue(ok({ email: "persona@example.com", id: "user-1" }));

    await signInAction(initialAuthFormState, credentials());

    expect(redirectMock).toHaveBeenCalledWith("/packages");
  });

  it("presenta el fallo de credenciales a nivel de formulario sin marcar un campo", async () => {
    authMock.signIn.mockResolvedValue(
      err({
        code: "invalid_credentials",
        message: "El correo o la contraseña no son correctos.",
      }),
    );

    const state = await signInAction(initialAuthFormState, credentials());

    expect(state).toEqual({
      status: "error",
      message: "El correo o la contraseña no son correctos.",
      field: undefined,
      email: "persona@example.com",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("conserva el campo señalado por la validación de entrada", async () => {
    authMock.signIn.mockResolvedValue(
      err({ code: "invalid_input", message: "Escribe tu contraseña.", field: "password" }),
    );

    const state = await signInAction(initialAuthFormState, credentials("persona@example.com", ""));

    expect(state.field).toBe("password");
  });

  it("devuelve el correo tal como se escribió para reponerlo, nunca la contraseña", async () => {
    authMock.signIn.mockResolvedValue(
      err({ code: "invalid_input", message: "El correo electrónico no tiene un formato válido.", field: "email" }),
    );

    const state = await signInAction(initialAuthFormState, credentials(" Persona@ ", "secreto"));

    expect(state.email).toBe(" Persona@ ");
    expect(JSON.stringify(state)).not.toContain("secreto");
  });

  it("cierra sesión y envía a /login", async () => {
    authMock.signOut.mockResolvedValue(ok(undefined));

    await signOutAction();

    expect(authMock.signOut).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("no finge un cierre de sesión si Supabase falla", async () => {
    authMock.signOut.mockResolvedValue(
      err({ code: "unknown", message: "No pudimos completar la operación. Inténtalo de nuevo." }),
    );

    await signOutAction();

    expect(redirectMock).toHaveBeenCalledWith("/packages?logout=error");
    expect(redirectMock).not.toHaveBeenCalledWith("/login");
  });
});
