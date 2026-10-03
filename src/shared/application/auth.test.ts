import { describe, expect, it } from "vitest";

import { err, ok } from "../domain/result";
import type { AuthFailure, RegistrationOutcome, SessionUser } from "../domain/session";

import { createAuthUseCases, validateCredentials } from "./auth";
import type { SessionGateway } from "./ports";

function createFakeGateway(overrides: Partial<SessionGateway> = {}) {
  const calls: string[] = [];

  const gateway: SessionGateway = {
    async register(credentials) {
      calls.push(`register:${credentials.email}`);

      return ok<RegistrationOutcome>({ kind: "confirmed" });
    },
    async authenticate(credentials) {
      calls.push(`authenticate:${credentials.email}`);

      return ok<SessionUser>({ id: "user-1", email: credentials.email });
    },
    async signOut() {
      calls.push("signOut");

      return ok(undefined);
    },
    async currentUser() {
      calls.push("currentUser");

      return { id: "user-1", email: "persona@example.com" };
    },
    ...overrides,
  };

  return { calls, gateway };
}

const invalidCredentials = (field?: "email" | "password"): AuthFailure => ({
  code: "invalid_credentials",
  message: "El correo o la contraseña no son correctos.",
  field,
});

describe("validación de credenciales", () => {
  it("normaliza el correo antes de delegar", () => {
    const result = validateCredentials({ email: "  Persona@Example.COM ", password: "secreto" });

    expect(result).toEqual(ok({ email: "persona@example.com", password: "secreto" }));
  });

  it("rechaza un correo vacío y lo asocia al campo email", () => {
    const result = validateCredentials({ email: "   ", password: "secreto" });

    expect(result).toEqual(err({ code: "invalid_input", message: "Escribe tu correo electrónico.", field: "email" }));
  });

  it("rechaza un correo con formato inválido", () => {
    const result = validateCredentials({ email: "persona@", password: "secreto" });

    expect(result.ok).toBe(false);
  });

  it("rechaza una contraseña vacía y lo asocia al campo password", () => {
    const result = validateCredentials({ email: "persona@example.com", password: "" });

    expect(result).toEqual(err({ code: "invalid_input", message: "Escribe tu contraseña.", field: "password" }));
  });
});

describe("casos de uso de autenticación", () => {
  it("no llama al puerto cuando el correo no es válido", async () => {
    const { calls, gateway } = createFakeGateway();
    const auth = createAuthUseCases(gateway);

    const result = await auth.signUp({ email: "persona@", password: "secreto" });

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("registra con el correo normalizado", async () => {
    const { calls, gateway } = createFakeGateway();
    const auth = createAuthUseCases(gateway);

    const result = await auth.signUp({ email: " Persona@Example.com ", password: "secreto" });

    expect(result).toEqual(ok({ kind: "confirmed" }));
    expect(calls).toEqual(["register:persona@example.com"]);
  });

  it("distingue el registro pendiente de confirmación como éxito", async () => {
    const { gateway } = createFakeGateway({
      async register() {
        return ok<RegistrationOutcome>({
          kind: "pending_confirmation",
          email: "persona@example.com",
        });
      },
    });
    const auth = createAuthUseCases(gateway);

    const result = await auth.signUp({ email: "persona@example.com", password: "secreto" });

    expect(result.ok).toBe(true);
  });

  it("devuelve el fallo del puerto al registrar", async () => {
    const { gateway } = createFakeGateway({
      async register() {
        return err<AuthFailure>({
          code: "email_taken",
          message: "Ya existe una cuenta con ese correo. Intenta iniciar sesión.",
          field: "email",
        });
      },
    });
    const auth = createAuthUseCases(gateway);

    const result = await auth.signUp({ email: "persona@example.com", password: "secreto" });

    expect(result).toEqual(
      err({
        code: "email_taken",
        message: "Ya existe una cuenta con ese correo. Intenta iniciar sesión.",
        field: "email",
      }),
    );
  });

  it("devuelve la identidad al iniciar sesión", async () => {
    const { calls, gateway } = createFakeGateway();
    const auth = createAuthUseCases(gateway);

    const result = await auth.signIn({ email: "persona@example.com", password: "secreto" });

    expect(result).toEqual(ok({ id: "user-1", email: "persona@example.com" }));
    expect(calls).toEqual(["authenticate:persona@example.com"]);
  });

  it("deja el fallo de credenciales sin campo para mostrarlo a nivel de formulario", async () => {
    const { gateway } = createFakeGateway({
      async authenticate() {
        return err<AuthFailure>(invalidCredentials());
      },
    });
    const auth = createAuthUseCases(gateway);

    const result = await auth.signIn({ email: "persona@example.com", password: "mala" });

    expect(result).toEqual(err(invalidCredentials()));
  });

  it("cierra sesión y lee la sesión actual por el mismo puerto", async () => {
    const { calls, gateway } = createFakeGateway();
    const auth = createAuthUseCases(gateway);

    await auth.signOut();
    const user = await auth.currentUser();

    expect(calls).toEqual(["signOut", "currentUser"]);
    expect(user).toEqual({ id: "user-1", email: "persona@example.com" });
  });
});
