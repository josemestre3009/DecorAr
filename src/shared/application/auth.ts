import { err, ok, type Result } from "../domain/result";
import type { AuthFailure, RegistrationOutcome, SessionUser } from "../domain/session";

import type { Credentials, SessionGateway } from "./ports";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalidInput(message: string, field: "email" | "password"): Result<never, AuthFailure> {
  return err({ code: "invalid_input", message, field });
}

export function validateCredentials(input: Credentials): Result<Credentials, AuthFailure> {
  const email = input.email.trim().toLowerCase();
  const { password } = input;

  if (email.length === 0) {
    return invalidInput("Escribe tu correo electrónico.", "email");
  }

  if (!EMAIL_PATTERN.test(email)) {
    return invalidInput("El correo electrónico no tiene un formato válido.", "email");
  }

  if (password.length === 0) {
    return invalidInput("Escribe tu contraseña.", "password");
  }

  return ok({ email, password });
}

export function createAuthUseCases(gateway: SessionGateway) {
  return {
    async signUp(input: Credentials): Promise<Result<RegistrationOutcome, AuthFailure>> {
      const credentials = validateCredentials(input);

      return credentials.ok ? gateway.register(credentials.value) : credentials;
    },

    async signIn(input: Credentials): Promise<Result<SessionUser, AuthFailure>> {
      const credentials = validateCredentials(input);

      return credentials.ok ? gateway.authenticate(credentials.value) : credentials;
    },

    async signOut(): Promise<Result<void, AuthFailure>> {
      return gateway.signOut();
    },

    async currentUser(): Promise<SessionUser | null> {
      return gateway.currentUser();
    },
  };
}

export type AuthUseCases = ReturnType<typeof createAuthUseCases>;
