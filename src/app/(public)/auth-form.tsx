"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { Icon } from "../(protected)/_ui/icon";
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
    lead: "Entra para seguir decorando tu evento.",
    submit: "Entrar",
    pending: "Entrando…",
    passwordAutoComplete: "current-password",
    question: "¿Aún no tienes cuenta?",
    link: "Regístrate",
    href: "/signup",
  },
  signup: {
    title: "Crear cuenta",
    lead: "Guarda tus paquetes y míralos en 3D en tu espacio.",
    submit: "Crear cuenta",
    pending: "Creando tu cuenta…",
    passwordAutoComplete: "new-password",
    question: "¿Ya tienes cuenta?",
    link: "Inicia sesión",
    href: "/login",
  },
} as const;

/** Marca de error: un círculo con "!" dibujado, sin librería de íconos. */
function ErrorMark() {
  return (
    <svg aria-hidden="true" className="auth-error-mark" fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="8" cy="11.25" fill="currentColor" r="0.9" />
    </svg>
  );
}

function FieldError({ id, children }: { readonly id?: string; readonly children: string }) {
  // role="alert" porque el error se inserta tras el envío y el foco sigue en
  // el botón: aria-describedby lo relaciona con el campo, pero un lector de
  // pantalla no lo anuncia.
  return (
    <p className="auth-field-error" id={id} role="alert">
      <ErrorMark />
      <span>{children}</span>
    </p>
  );
}

/**
 * Panel de marca (rediseño visual): cobre arriba en el celular y una imagen
 * a la izquierda en escritorio.
 */
function BrandPanel() {
  return (
    <div className="auth-hero">
      <span className="auth-hero-logo">
        <Image alt="DecorAR" className="auth-hero-logo-img" height={240} priority src="/landing/logo.webp" width={242} />
      </span>
      <p className="auth-hero-tagline">Diseña tu evento en 3D antes de montarlo.</p>
    </div>
  );
}

/** Tras registrarse, el proyecto exige confirmar el correo antes de entrar. */
function ConfirmEmail({ message }: { readonly message: string }) {
  const heading = useRef<HTMLHeadingElement>(null);

  // El formulario desaparece: el foco pasa al título para no perderse.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="auth-confirm">
      <span aria-hidden="true" className="auth-confirm-icon">
        <Icon name="mail" size={30} />
      </span>

      <h1 className="auth-card-title" ref={heading} tabIndex={-1}>
        Revisa tu correo
      </h1>

      <p className="auth-card-lead auth-confirm-message" role="status">
        {message}
      </p>
      <p className="auth-card-note">
        Abre el enlace que te enviamos para activar tu cuenta. Si no lo ves en unos minutos, busca en la carpeta de
        spam.
      </p>

      <a className="auth-primary" href="/login">
        Ir a iniciar sesión
        <Icon name="arrowRight" />
      </a>
      {/* Navegación completa: reinicia el formulario para escribir otro correo. */}
      <a className="auth-secondary" href="/signup">
        Usar otro correo
      </a>
    </div>
  );
}

export function AuthForm({ mode, action }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, initialAuthFormState);
  const [showPassword, setShowPassword] = useState(false);
  const copy = COPY[mode];

  const emailError =
    state.status === "error" && state.field === "email" ? state.message : undefined;
  const passwordError =
    state.status === "error" && state.field === "password" ? state.message : undefined;
  const formError = state.status === "error" && !state.field ? state.message : undefined;

  return (
    <div className="auth-shell">
      <BrandPanel />

      <section className="auth-card">
        {state.status === "pending_confirmation" ? (
          <ConfirmEmail message={state.message} />
        ) : (
          <>
            <h1 className="auth-card-title">{copy.title}</h1>
            <p className="auth-card-lead">{copy.lead}</p>

            <form action={formAction} className="auth-card-form" noValidate>
              <div className="auth-field">
                <label className="auth-label" htmlFor="email">
                  Correo electrónico
                </label>
                <div className="auth-input-wrap">
                  <Icon className="auth-input-icon" name="mail" />
                  <input
                    aria-describedby={emailError ? "email-error" : undefined}
                    aria-invalid={emailError ? true : undefined}
                    autoComplete="email"
                    className="auth-input auth-input-with-icon"
                    defaultValue={state.email}
                    id="email"
                    inputMode="email"
                    name="email"
                    placeholder="tu@correo.com"
                    required
                    type="email"
                  />
                </div>
                {emailError ? <FieldError id="email-error">{emailError}</FieldError> : null}
              </div>

              <div className="auth-field">
                <label className="auth-label" htmlFor="password">
                  Contraseña
                </label>
                <div className="auth-input-wrap">
                  <Icon className="auth-input-icon" name="lock" />
                  <input
                    aria-describedby={passwordError ? "password-error" : undefined}
                    aria-invalid={passwordError ? true : undefined}
                    autoComplete={copy.passwordAutoComplete}
                    className="auth-input auth-input-with-icon auth-input-with-action"
                    id="password"
                    name="password"
                    required
                    type={showPassword ? "text" : "password"}
                  />
                  {/*
                    Nombre fijo + aria-pressed: el estado lo anuncia el lector de
                    pantalla. El nombre va como texto oculto (no aria-label) para
                    que "Contraseña" siga identificando solo al campo.
                  */}
                  <button
                    aria-controls="password"
                    aria-pressed={showPassword}
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    type="button"
                  >
                    <Icon name={showPassword ? "eyeOff" : "eye"} />
                    <span className="visually-hidden">Mostrar contraseña</span>
                  </button>
                </div>
                {passwordError ? <FieldError id="password-error">{passwordError}</FieldError> : null}
              </div>

              {formError ? (
                <div className="auth-form-error">
                  <FieldError>{formError}</FieldError>
                </div>
              ) : null}

              <button className="auth-primary" disabled={pending} type="submit">
                {pending ? copy.pending : copy.submit}
                {pending ? null : <Icon name="arrowRight" />}
              </button>
            </form>

            <div className="auth-switch">
              <p>{copy.question}</p>
              <a className="auth-secondary" href={copy.href}>
                {copy.link}
              </a>
            </div>
          </>
        )}

        <Link className="back-link auth-home-link" href="/">
          <Icon name="back" size={18} />
          Volver al inicio
        </Link>
      </section>
    </div>
  );
}
