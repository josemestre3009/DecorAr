import { describe, expectTypeOf, it } from "vitest";

import type { AuthFailure, RegistrationOutcome, SessionUser } from "../domain/session";
import type { Result } from "../domain/result";

import type { Clock, Credentials, IdGenerator, Logger, SessionGateway } from "./ports";

describe("shared application ports", () => {
  it("mantiene contratos independientes de infraestructura", () => {
    expectTypeOf<Clock["now"]>().returns.toEqualTypeOf<Date>();
    expectTypeOf<IdGenerator["generate"]>().returns.toBeString();
    expectTypeOf<Logger["error"]>().parameters.toMatchTypeOf<
      [message: string, context?: Readonly<Record<string, unknown>>]
    >();
  });

  it("expone el acceso a la sesión como promesas de Result", () => {
    expectTypeOf<SessionGateway["register"]>().toEqualTypeOf<
      (credentials: Credentials) => Promise<Result<RegistrationOutcome, AuthFailure>>
    >();
    expectTypeOf<SessionGateway["authenticate"]>().toEqualTypeOf<
      (credentials: Credentials) => Promise<Result<SessionUser, AuthFailure>>
    >();
    expectTypeOf<SessionGateway["signOut"]>().toEqualTypeOf<
      () => Promise<Result<void, AuthFailure>>
    >();
    expectTypeOf<SessionGateway["currentUser"]>().toEqualTypeOf<
      () => Promise<SessionUser | null>
    >();
  });
});
