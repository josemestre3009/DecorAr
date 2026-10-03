"use client";

import { useActionState } from "react";

import { initialAuthFormState, type AuthFormState } from "../auth-form-state";

type AuthFormProps = {
  readonly mode: "login" | "signup";
  readonly action: (
    previousState: AuthFormState,
    formData: FormData,
  ) => Promise<AuthFormState>;
};

const COPY = {
  login: {
    title: "Iniciar sesión",
    submit: "Entrar",
    pending: "Entrando…",
    passwordAutoComplete: "current-password",
    question: "¿Aún no tienes cuenta?",
    link: "Regístrate",
    href: "/signup",
  },
  signup: {
    title: "Crear cuenta",
    submit: "Crear cuenta",
    pending: "Creando tu cuenta…",
    passwordAutoComplete: "new-password",
    question: "¿Ya tienes cuenta?",
    link: "Inicia sesión",
    href: "/login",
  },
} as const;

export function AuthForm({ mode, action }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, initialAuthFormState);
  const copy = COPY[mode];

  const emailError =
    state.status === "error" && state.field === "email" ? state.message : undefined;
  const passwordError =
    state.status === "error" && state.field === "password" ? state.message : undefined;
  const formError = state.status === "error" && !state.field ? state.message : undefined;

  return (
    <section className="auth">
      <h1 className="auth-title">{copy.title}</h1>

      <form action={formAction} className="auth-form" noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="email">
            Correo electrónico
          </label>
          <input
            aria-describedby={emailError ? "email-error" : undefined}
            aria-invalid={emailError ? true : undefined}
            autoComplete="email"
            className="auth-input"
            id="email"
            name="email"
            required
            type="email"
          />
          {emailError ? (
            <p className="auth-error" id="email-error">
              {emailError}
            </p>
          ) : null}
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="password">
            Contraseña
          </label>
          <input
            aria-describedby={passwordError ? "password-error" : undefined}
            aria-invalid={passwordError ? true : undefined}
            autoComplete={copy.passwordAutoComplete}
            className="auth-input"
            id="password"
            name="password"
            required
            type="password"
          />
          {passwordError ? (
            <p className="auth-error" id="password-error">
              {passwordError}
            </p>
          ) : null}
        </div>

        {formError ? (
          <p className="auth-error" role="alert">
            {formError}
          </p>
        ) : null}

        {state.status === "pending_confirmation" ? (
          <p className="auth-notice" role="status">
            {state.message}
          </p>
        ) : null}

        <button className="auth-submit" disabled={pending} type="submit">
          {pending ? copy.pending : copy.submit}
        </button>
      </form>

      <p className="auth-switch">
        {copy.question}{" "}
        <a className="auth-link" href={copy.href}>
          {copy.link}
        </a>
      </p>
    </section>
  );
}
