import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabasePackageReader } from "./supabase-package-reader";

function fakeListClient(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const chain = {
    eq: (column: string, value: unknown) => {
      calls.push(["eq", column, value]);
      return chain;
    },
    order: (column: string, options: unknown) => {
      calls.push(["order", column, options]);
      return Promise.resolve(result);
    },
    select: (columns: string) => {
      calls.push(["select", columns]);
      return chain;
    },
  };
  return {
    calls,
    client: { from: vi.fn(() => chain) } as unknown as SupabaseClient,
  };
}

describe("SupabasePackageReader.listByOwner", () => {
  it("filtra por propietario, ordena por actualización descendente y mapea NUMERIC", async () => {
    const { calls, client } = fakeListClient({
      data: [
        { capacity_m2: "35.50", id: "reciente", space_type: "salonSocial", updated_at: "2026-10-12T15:00:00Z" },
        { capacity_m2: 20, id: "anterior", space_type: "casa", updated_at: "2026-10-11T15:00:00Z" },
      ],
      error: null,
    });

    const result = await new SupabasePackageReader(client).listByOwner("user-1");

    expect(calls).toEqual([
      ["select", "id, space_type, capacity_m2, updated_at"],
      ["eq", "user_id", "user-1"],
      ["order", "updated_at", { ascending: false }],
    ]);
    expect(result).toEqual(ok([
      { capacityM2: 35.5, id: "reciente", spaceType: "salonSocial", updatedAt: "2026-10-12T15:00:00Z" },
      { capacityM2: 20, id: "anterior", spaceType: "casa", updatedAt: "2026-10-11T15:00:00Z" },
    ]));
  });

  it("devuelve lista vacía y convierte errores", async () => {
    const empty = fakeListClient({ data: null, error: null });
    expect(await new SupabasePackageReader(empty.client).listByOwner("user-1")).toEqual(ok([]));

    const failing = fakeListClient({ data: null, error: { message: "boom" } });
    const result = await new SupabasePackageReader(failing.client).listByOwner("user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.persistence_error");
  });

  it("conserva paquetes legacy sin inventar tipo ni capacidad", async () => {
    const { client } = fakeListClient({
      data: [{ capacity_m2: null, id: "legacy", space_type: null, updated_at: "2026-10-10T15:00:00Z" }],
      error: null,
    });

    expect(await new SupabasePackageReader(client).listByOwner("user-1")).toEqual(ok([
      { capacityM2: null, id: "legacy", spaceType: null, updatedAt: "2026-10-10T15:00:00Z" },
    ]));
  });
});

function ok<T>(value: T) {
  return { ok: true as const, value };
}
