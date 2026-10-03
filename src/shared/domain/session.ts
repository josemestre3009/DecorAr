export type SessionUser = {
  readonly id: string;
  readonly email: string;
};

export type AuthFailureCode =
  | "invalid_input"
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "rate_limited"
  | "unknown";

export type AuthFailure = {
  readonly code: AuthFailureCode;
  readonly message: string;
  /** Campo al que se asocia el mensaje con aria-describedby. Ausente = mensaje de formulario. */
  readonly field?: "email" | "password";
};

export type RegistrationOutcome =
  | { readonly kind: "confirmed" }
  | { readonly kind: "pending_confirmation"; readonly email: string };
