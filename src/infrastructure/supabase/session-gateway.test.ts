import { AuthError, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { ok } from "../../shared/domain/result";
import type { AuthFailure, RegistrationOutcome, SessionUser } from "../../shared/domain/session";

import { createSessionGateway } from "./session-gateway";

vi.mock("server-only", () => ({}));

type AuthMock = {
  signUp: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
};

function createFakeClient(overrides: Partial<AuthMock> = {}) {
  const auth: AuthMock = {
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { user: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    ...overrides,
  };

  return { auth, client: { auth } as unknown as SupabaseClient };
}

function authError(message: string, status = 400, code?: string) {
  return new AuthError(message, status, code);
}

async function expectFailure(promise: Promise<{ ok: boolean; error?: AuthFailure }>) {
  const result = await promise;

  expect(result.ok).toBe(false);

  return result.error as AuthFailure;
}

describe("adaptador de sesión Supabase", () => {
  it("envía las credenciales normalizadas al registro", async () => {
    const { auth, client } = createFakeClient();
    const gateway = createSessionGateway(client);

    await gateway.register({ email: "persona@example.com", password: "secreto" });

    expect(auth.signUp).toHaveBeenCalledWith({
      email: "persona@example.com",
      password: "secreto",
    });
  });

  it("informa el registro pendiente cuando el proyecto exige confirmar el correo", async () => {
    const { client } = createFakeClient();
    const gateway = createSessionGateway(client);

    const result = await gateway.register({ email: "persona@example.com", password: "secreto" });

    expect(result).toEqual(
      ok<RegistrationOutcome>({ kind: "pending_confirmation", email: "persona@example.com" }),
    );
  });

  it("informa el registro confirmado cuando la sesión viene poblada", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({ data: { session: { access_token: "t" } }, error: null })),
    });
    const gateway = createSessionGateway(client);

    const result = await gateway.register({ email: "persona@example.com", password: "secreto" });

    expect(result).toEqual(ok({ kind: "confirmed" }));
  });

  it("mapea un correo ya registrado al campo email", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({ data: {}, error: authError("User already registered", 422) })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.register({ email: "persona@example.com", password: "secreto" }),
    );

    expect(failure.code).toBe("email_taken");
    expect(failure.field).toBe("email");
  });

  it("mapea el límite de reintentos sin asociarlo a un campo", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({ data: {}, error: authError("Too many requests", 429) })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.register({ email: "persona@example.com", password: "secreto" }),
    );

    expect(failure.code).toBe("rate_limited");
    expect(failure.field).toBeUndefined();
  });

  it("mapea una contraseña demasiado corta al campo password", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({
        data: {},
        error: authError("Password should be at least 6 characters", 422),
      })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.register({ email: "persona@example.com", password: "corta" }),
    );

    expect(failure.code).toBe("weak_password");
    expect(failure.field).toBe("password");
  });

  it("no presupone la longitud cuando la contraseña es débil por otra causa", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({
        data: {},
        error: authError("Password is known to be weak and easy to guess", 422, "weak_password"),
      })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.register({ email: "persona@example.com", password: "contraseña123" }),
    );

    expect(failure.code).toBe("weak_password");
    expect(failure.field).toBe("password");
    expect(failure.message).not.toMatch(/corta|caracteres/);
  });

  it("asocia al campo email un correo que Supabase rechaza", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({
        data: {},
        error: authError("Email address is invalid", 400, "email_address_invalid"),
      })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.register({ email: "persona@example.com", password: "secreto" }),
    );

    expect(failure.code).toBe("invalid_input");
    expect(failure.field).toBe("email");
  });

  it("explica que el registro está desactivado en lugar de un mensaje genérico", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({
        data: {},
        error: authError("Signups not allowed for this instance", 422, "signup_disabled"),
      })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.register({ email: "persona@example.com", password: "secreto" }),
    );

    expect(failure.message).toMatch(/registro/);
    expect(failure.field).toBeUndefined();
  });

  it("informa que falta confirmar el correo en lugar de un mensaje genérico", async () => {
    const { client } = createFakeClient({
      signInWithPassword: vi.fn(async () => ({
        data: {},
        error: authError("Email not confirmed", 400, "email_not_confirmed"),
      })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.authenticate({ email: "persona@example.com", password: "secreto" }),
    );

    expect(failure.code).toBe("email_not_confirmed");
    expect(failure.message).toContain("Confirma tu correo");
    // El correo tecleado es correcto, así que el mensaje es de formulario y no
    // debe señalar un campo como si el valor introducido estuviera mal.
    expect(failure.field).toBeUndefined();
  });

  it("usa el código estable de Supabase en lugar del texto en inglés del error", async () => {
    const { client } = createFakeClient({
      signInWithPassword: vi.fn(async () => ({
        data: {},
        error: authError("Credenciales no válidas", 400, "invalid_credentials"),
      })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.authenticate({ email: "persona@example.com", password: "mala" }),
    );

    expect(failure.code).toBe("invalid_credentials");
    expect(failure.field).toBeUndefined();
  });

  it("mapea el límite de peticiones por código aunque el estado no sea 429", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({
        data: {},
        error: authError("Request rate limited", 400, "over_request_rate_limit"),
      })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.register({ email: "persona@example.com", password: "secreto" }),
    );

    expect(failure.code).toBe("rate_limited");
  });

  it("traduce un error desconocido a un mensaje genérico", async () => {
    const { client } = createFakeClient({
      signUp: vi.fn(async () => ({ data: {}, error: authError("boom", 500) })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.register({ email: "persona@example.com", password: "secreto" }),
    );

    expect(failure.code).toBe("unknown");
    expect(failure.message).not.toContain("boom");
  });

  it("devuelve la identidad al autenticar", async () => {
    const { client } = createFakeClient({
      signInWithPassword: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "persona@example.com" } },
        error: null,
      })),
    });
    const gateway = createSessionGateway(client);

    const result = await gateway.authenticate({ email: "persona@example.com", password: "secreto" });

    expect(result).toEqual(ok<SessionUser>({ id: "user-1", email: "persona@example.com" }));
  });

  it("mapea credenciales incorrectas a un mensaje de formulario", async () => {
    const { client } = createFakeClient({
      signInWithPassword: vi.fn(async () => ({
        data: {},
        error: authError("Invalid login credentials", 400),
      })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.authenticate({ email: "persona@example.com", password: "mala" }),
    );

    expect(failure.code).toBe("invalid_credentials");
    expect(failure.field).toBeUndefined();
  });

  it("trata una respuesta de autenticación sin usuario como credenciales incorrectas", async () => {
    const { client } = createFakeClient({
      signInWithPassword: vi.fn(async () => ({ data: { user: null }, error: null })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(
      gateway.authenticate({ email: "persona@example.com", password: "mala" }),
    );

    expect(failure.code).toBe("invalid_credentials");
  });

  it("cierra sesión sin error", async () => {
    const { client } = createFakeClient();
    const gateway = createSessionGateway(client);

    await expect(gateway.signOut()).resolves.toEqual(ok(undefined));
  });

  it("propaga el fallo al cerrar sesión", async () => {
    const { client } = createFakeClient({
      signOut: vi.fn(async () => ({ error: authError("boom", 500) })),
    });
    const gateway = createSessionGateway(client);

    const failure = await expectFailure(gateway.signOut());

    expect(failure.code).toBe("unknown");
  });

  it("devuelve la identidad de la sesión actual", async () => {
    const { client } = createFakeClient({
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-2", email: "otra@example.com" } },
        error: null,
      })),
    });
    const gateway = createSessionGateway(client);

    await expect(gateway.currentUser()).resolves.toEqual({
      id: "user-2",
      email: "otra@example.com",
    });
  });

  it("devuelve null cuando no hay sesión", async () => {
    const { client } = createFakeClient({
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    });
    const gateway = createSessionGateway(client);

    await expect(gateway.currentUser()).resolves.toBeNull();
  });

  it("valida la identidad con getUser y nunca con getSession", async () => {
    const { auth, client } = createFakeClient();
    const gateway = createSessionGateway(client);

    await gateway.currentUser();

    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});
