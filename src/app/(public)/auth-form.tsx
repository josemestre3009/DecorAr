"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

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

// Estilos compartidos. Los colores salen del tema (`decor-*`); el foco es un
// contorno sólido, que es lo que exige la prueba de accesibilidad. Tailwind va
// sin preflight: campos y botones declaran la fuente y el borde explícitamente.
const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid";
const INPUT =
  `h-12 w-full rounded-xl font-[inherit] border border-decor-ink/15 bg-decor-surface px-4 text-base text-decor-ink transition-colors placeholder:text-decor-ink-soft/60 hover:border-decor-ink/30 focus:border-decor-copper ${FOCUS} focus-visible:outline-offset-2 focus-visible:outline-decor-copper aria-[invalid=true]:border-decor-copper-dark motion-reduce:transition-none`;
const PRIMARY =
  `inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-full border-0 bg-decor-copper font-[inherit] px-6 text-base font-medium text-white no-underline transition duration-150 hover:bg-decor-copper-dark active:scale-[0.98] active:bg-decor-copper-dark disabled:cursor-wait disabled:opacity-70 disabled:active:scale-100 ${FOCUS} focus-visible:outline-offset-4 focus-visible:outline-decor-ink motion-reduce:transition-none motion-reduce:active:scale-100`;
const TEXT_LINK =
  `rounded-sm font-medium text-decor-copper-dark underline underline-offset-4 hover:text-decor-ink ${FOCUS} focus-visible:outline-offset-2 focus-visible:outline-decor-copper`;

/** Marca de error: un círculo con "!" dibujado, sin librería de íconos. */
function ErrorMark() {
  return (
    <svg aria-hidden="true" className="mt-0.5 size-4 shrink-0" fill="none" viewBox="0 0 16 16">
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
    <p className="mt-2 flex gap-2 text-sm leading-snug text-decor-copper-dark" id={id} role="alert">
      <ErrorMark />
      <span>{children}</span>
    </p>
  );
}

function Brand() {
  return (
    <Image
      alt="DecorAR"
      className="mx-auto block h-16 w-auto"
      height={240}
      priority
      src="/landing/logo.webp"
      width={242}
    />
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
    <div className="text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-decor-copper-light text-decor-copper-dark">
        <svg aria-hidden="true" className="size-8" fill="none" viewBox="0 0 32 32">
          <rect height="18" rx="2.5" stroke="currentColor" strokeWidth="1.75" width="24" x="4" y="7" />
          <path d="m5 9 11 8.5L27 9" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.75" />
        </svg>
      </div>

      <h1
        className="mt-6 text-[1.875rem] leading-[1.15] font-normal tracking-[-0.02em] outline-none"
        ref={heading}
        tabIndex={-1}
      >
        Revisa tu correo
      </h1>

      <p className="mt-3 text-base leading-relaxed text-decor-ink" role="status">
        {message}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-decor-ink-soft">
        Abre el enlace que te enviamos para activar tu cuenta. Si no lo ves en unos minutos, busca en
        la carpeta de spam.
      </p>

      <a className={`mt-8 ${PRIMARY}`} href="/login">
        Ir a iniciar sesión
      </a>
      {/* Navegación completa: reinicia el formulario para escribir otro correo. */}
      <a className={`mt-5 inline-block text-sm ${TEXT_LINK}`} href="/signup">
        Usar otro correo
      </a>
    </div>
  );
}

export function AuthForm({ mode, action }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, initialAuthFormState);
  const copy = COPY[mode];

  const emailError =
    state.status === "error" && state.field === "email" ? state.message : undefined;
  const passwordError =
    state.status === "error" && state.field === "password" ? state.message : undefined;
  const formError = state.status === "error" && !state.field ? state.message : undefined;

  return (
    <section className="w-full max-w-[400px] lg:rounded-xl lg:border lg:border-decor-ink/10 lg:bg-decor-surface lg:px-10 lg:py-12">
      <Brand />

      <div className="mt-8">
        {state.status === "pending_confirmation" ? (
          <ConfirmEmail message={state.message} />
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-[1.875rem] leading-[1.15] font-normal tracking-[-0.02em]">{copy.title}</h1>
              <p className="mt-2 text-base leading-relaxed text-decor-ink-soft">{copy.lead}</p>
            </div>

            <form action={formAction} className="mt-8 flex flex-col gap-5" noValidate>
              <div>
                <label className="mb-2 block text-sm font-medium text-decor-ink" htmlFor="email">
                  Correo electrónico
                </label>
                <input
                  aria-describedby={emailError ? "email-error" : undefined}
                  aria-invalid={emailError ? true : undefined}
                  autoComplete="email"
                  className={INPUT}
                  defaultValue={state.email}
                  id="email"
                  inputMode="email"
                  name="email"
                  placeholder="tu@correo.com"
                  required
                  type="email"
                />
                {emailError ? <FieldError id="email-error">{emailError}</FieldError> : null}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-decor-ink" htmlFor="password">
                  Contraseña
                </label>
                <input
                  aria-describedby={passwordError ? "password-error" : undefined}
                  aria-invalid={passwordError ? true : undefined}
                  autoComplete={copy.passwordAutoComplete}
                  className={INPUT}
                  id="password"
                  name="password"
                  required
                  type="password"
                />
                {passwordError ? <FieldError id="password-error">{passwordError}</FieldError> : null}
              </div>

              {formError ? (
                <div className="rounded-xl bg-decor-copper-light/60 px-4 py-3">
                  <FieldError>{formError}</FieldError>
                </div>
              ) : null}

              <button className={`mt-2 ${PRIMARY}`} disabled={pending} type="submit">
                {pending ? copy.pending : copy.submit}
              </button>
            </form>

            <p className="mt-8 text-center text-base text-decor-ink-soft">
              {copy.question}{" "}
              <a className={TEXT_LINK} href={copy.href}>
                {copy.link}
              </a>
            </p>
          </>
        )}

        <p className="mt-6 text-center">
          <Link
            className={`rounded-sm text-sm text-decor-ink-soft no-underline underline-offset-4 hover:underline ${FOCUS} focus-visible:outline-offset-2 focus-visible:outline-decor-copper`}
            href="/"
          >
            ← Volver al inicio
          </Link>
        </p>
      </div>
    </section>
  );
}
