import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createPackageOwnerReader } from "./package-owner-reader";

vi.mock("server-only", () => ({}));

function clientReturning(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;

  return { client, query };
}

describe("createPackageOwnerReader", () => {
  it("lee sólo user_id del paquete pedido", async () => {
    const { client, query } = clientReturning({ data: { user_id: "owner" }, error: null });

    expect(await createPackageOwnerReader(client).findOwnerId("pkg")).toEqual({ ok: true, value: "owner" });
    expect(client.from).toHaveBeenCalledWith("packages");
    expect(query.select).toHaveBeenCalledWith("user_id");
    expect(query.eq).toHaveBeenCalledWith("id", "pkg");
  });

  it("devuelve null cuando RLS oculta el paquete o no existe", async () => {
    const { client } = clientReturning({ data: null, error: null });

    expect(await createPackageOwnerReader(client).findOwnerId("pkg")).toEqual({ ok: true, value: null });
  });

  it("traduce el error de PostgREST a package.persistence_error", async () => {
    const { client } = clientReturning({ data: null, error: { message: "boom" } });
    const result = await createPackageOwnerReader(client).findOwnerId("pkg");

    expect(!result.ok && result.error.code).toBe("package.persistence_error");
  });
});
