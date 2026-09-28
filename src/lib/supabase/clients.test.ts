import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "./admin";
import { createClient as createBrowserSupabaseClient } from "./browser";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: vi.fn(() => ({})) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({})) }));

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("Supabase client boundaries", () => {
  it("crea el cliente browser sólo con configuración pública", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "private-value";

    createBrowserSupabaseClient();

    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "sb_publishable_example",
    );
  });

  it("crea el cliente admin sin persistir sesión", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-example";

    createAdminClient();

    expect(createSupabaseClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-example",
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
  });
});
