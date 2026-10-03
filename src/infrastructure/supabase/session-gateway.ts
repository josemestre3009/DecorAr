import "server-only";

import type { AuthError, SupabaseClient } from "@supabase/supabase-js";

import type { Credentials, SessionGateway } from "../../shared/application/ports";
import { err, ok, type Result } from "../../shared/domain/result";
import type { AuthFailure, RegistrationOutcome, SessionUser } from "../../shared/domain/session";

type SessionClient = SupabaseClient;

/**
 * Códigos de error que Supabase devuelve estables, a diferencia de `message`,
 * que es texto en inglés y puede cambiar o traducirse. Se consultedan primero y
 * el texto queda como respaldo para las respuestas que llegan sin código.
 */
const FAILURES_BY_CODE: Readonly<Record<string, AuthFailure>> = {
  email_not_confirmed: {
    code: "email_not_confirmed",
    message: "Confirma tu correo antes de iniciar sesión.",
  },
  invalid_credentials: {
    code: "invalid_credentials",
    message: "El correo o la contraseña no son correctos.",
  },
  email_exists: {
    code: "email_taken",
    message: "Ya existe una cuenta con ese correo. Intenta iniciar sesión.",
    field: "email",
  },
  user_already_exists: {
    code: "email_taken",
    message: "Ya existe una cuenta con ese correo. Intenta iniciar sesión.",
    field: "email",
  },
  weak_password: {
    code: "weak_password",
    message: "La contraseña es demasiado corta. Usa al menos 6 caracteres.",
    field: "password",
  },
  over_request_rate_limit: {
    code: "rate_limited",
    message: "Has intentado demasiadas veces. Espera un momento e inténtalo de nuevo.",
  },
  over_email_send_rate_limit: {
    code: "rate_limited",
    message: "Has intentado demasiadas veces. Espera un momento e inténtalo de nuevo.",
  },
};

function toSessionUser(user: { id: string; email?: string }): SessionUser {
  return { id: user.id, email: user.email ?? "" };
}

function toFailure(error: AuthError): AuthFailure {
  const byCode = error.code ? FAILURES_BY_CODE[error.code] : undefined;

  if (byCode) {
    return byCode;
  }

  // Respaldo por texto para las respuestas que llegan sin código estable.
  const detail = error.message.toLowerCase();

  if (error.status === 429 || detail.includes("too many") || detail.includes("rate limit")) {
    return {
      code: "rate_limited",
      message: "Has intentado demasiadas veces. Espera un momento e inténtalo de nuevo.",
    };
  }

  if (detail.includes("invalid login credentials")) {
    return {
      code: "invalid_credentials",
      message: "El correo o la contraseña no son correctos.",
    };
  }

  if (detail.includes("user already registered") || detail.includes("already been registered")) {
    return {
      code: "email_taken",
      message: "Ya existe una cuenta con ese correo. Intenta iniciar sesión.",
      field: "email",
    };
  }

  if (detail.includes("password")) {
    return {
      code: "weak_password",
      message: "La contraseña es demasiado corta. Usa al menos 6 caracteres.",
      field: "password",
    };
  }

  return {
    code: "unknown",
    message: "No pudimos completar la operación. Inténtalo de nuevo.",
  };
}

export function createSessionGateway(client: SessionClient): SessionGateway {
  return {
    async register(
      credentials: Credentials,
    ): Promise<Result<RegistrationOutcome, AuthFailure>> {
      const { data, error } = await client.auth.signUp({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) {
        return err(toFailure(error));
      }

      // El proyecto exige confirmar el correo: sin sesión aún, el registro es
      // un éxito pendiente y no un fallo.
      if (!data.session) {
        return ok({ kind: "pending_confirmation", email: credentials.email });
      }

      return ok({ kind: "confirmed" });
    },

    async authenticate(
      credentials: Credentials,
    ): Promise<Result<SessionUser, AuthFailure>> {
      // La respuesta de signInWithPassword ya viene validada por el servidor de
      // autenticación, por lo que no hace falta un getUser adicional aquí.
      const { data, error } = await client.auth.signInWithPassword(credentials);

      if (error) {
        return err(toFailure(error));
      }

      if (!data.user) {
        return err({
          code: "invalid_credentials",
          message: "El correo o la contraseña no son correctos.",
        });
      }

      return ok(toSessionUser(data.user));
    },

    async signOut(): Promise<Result<void, AuthFailure>> {
      const { error } = await client.auth.signOut();

      if (error) {
        return err(toFailure(error));
      }

      return ok(undefined);
    },

    async currentUser(): Promise<SessionUser | null> {
      // getUser() siempre valida el token contra el servidor de autenticación,
      // a diferencia de getSession() que sólo lee la cookie. La autorización de
      // los Route Handlers no debe depender de que RLS esté configurado.
      const { data, error } = await client.auth.getUser();

      if (error || !data.user) {
        return null;
      }

      return toSessionUser(data.user);
    },
  };
}
