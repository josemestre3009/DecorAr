import type { AuthFailure, RegistrationOutcome, SessionUser } from "../domain/session";
import type { Result } from "../domain/result";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export interface Logger {
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

/**
 * Backoff delay before a bounded retry (DECOR-31). A real implementation
 * waits `ms` milliseconds; test doubles resolve immediately and record the
 * calls, so a test asserts the exact backoff schedule without ever waiting.
 */
export interface Sleep {
  wait(ms: number): Promise<void>;
}

export type Credentials = {
  readonly email: string;
  readonly password: string;
};

export interface SessionGateway {
  register(credentials: Credentials): Promise<Result<RegistrationOutcome, AuthFailure>>;
  authenticate(credentials: Credentials): Promise<Result<SessionUser, AuthFailure>>;
  signOut(): Promise<Result<void, AuthFailure>>;
  currentUser(): Promise<SessionUser | null>;
}
