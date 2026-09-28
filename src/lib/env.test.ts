import { afterEach, describe, expect, it } from "vitest";

import { getAdminSupabaseEnv, getPublicSupabaseEnv, requireEnv } from "./env";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("environment validation", () => {
  it("identifica una variable ausente", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => requireEnv("SUPABASE_SERVICE_ROLE_KEY")).toThrow(
      "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("devuelve únicamente configuración pública para Supabase", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "private-value";

    expect(getPublicSupabaseEnv()).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_example",
    });
  });

  it("identifica una clave pública ausente", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(() => getPublicSupabaseEnv()).toThrow(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("identifica una service role ausente para el cliente admin", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => getAdminSupabaseEnv()).toThrow(
      "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY",
    );
  });
});
