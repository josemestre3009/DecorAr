"use server";

import { redirect } from "next/navigation";

import { createSessionDependencies } from "@/composition/server";
import type { AuthFailure } from "@/shared/domain/session";

import type { AuthFormState } from "./auth-form-state";

function toFormState(failure: AuthFailure, email: string): AuthFormState {
  return { status: "error", message: failure.message, field: failure.field, email };
}

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signUpAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { auth } = await createSessionDependencies();
  const credentials = readCredentials(formData);
  const result = await auth.signUp(credentials);

  if (!result.ok) {
    return toFormState(result.error, credentials.email);
  }

  // El proyecto exige confirmar el correo: es un éxito pendiente, no un error.
  if (result.value.kind === "pending_confirmation") {
    return {
      status: "pending_confirmation",
      message: `Revisa el correo ${result.value.email} y confirma tu cuenta para poder entrar.`,
    };
  }

  redirect("/packages");
}

export async function signInAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { auth } = await createSessionDependencies();
  const credentials = readCredentials(formData);
  const result = await auth.signIn(credentials);

  if (!result.ok) {
    return toFormState(result.error, credentials.email);
  }

  redirect("/packages");
}

export async function signOutAction(): Promise<void> {
  const { auth } = await createSessionDependencies();
  const result = await auth.signOut();

  // Redirigir a /login aunque Supabase falle daría por cerrada una sesión que
  // sigue viva. /packages ya es dinámica, así que el aviso no altera la tabla
  // de rutas: /login y /signup siguen siendo estáticas.
  if (!result.ok) {
    return redirect("/packages?logout=error");
  }

  return redirect("/login");
}
