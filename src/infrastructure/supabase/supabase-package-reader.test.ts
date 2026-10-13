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

const SELECT =
  "id, name, space_type, capacity_m2, client_name, event_date, venue, event_type, updated_at, package_items(catalog_modules(area_m2))";

describe("SupabasePackageReader.listByOwner", () => {
  it("filtra por propietario, ordena por actualización descendente y calcula el diagnóstico espacial", async () => {
    const { calls, client } = fakeListClient({
      data: [
        {
          capacity_m2: "35.50",
          event_type: null,
          id: "reciente",
          name: "Boda Ana",
          package_items: [{ catalog_modules: { area_m2: "10.00" } }],
          space_type: "salonSocial",
          updated_at: "2026-10-12T15:00:00Z",
        },
        {
          capacity_m2: 20,
          event_type: null,
          id: "anterior",
          name: "Cumpleaños",
          package_items: [],
          space_type: "casa",
          updated_at: "2026-10-11T15:00:00Z",
        },
      ],
      error: null,
    });

    const result = await new SupabasePackageReader(client).listByOwner("user-1");

    expect(calls).toEqual([
      ["select", SELECT],
      ["eq", "user_id", "user-1"],
      ["order", "updated_at", { ascending: false }],
    ]);
    expect(result).toEqual(ok([
      {
        capacityM2: 35.5,
        clientName: null,
        eventDate: null,
        eventType: null,
        id: "reciente",
        name: "Boda Ana",
        spaceType: "salonSocial",
        spatial: { availableM2: 35.5, requiredM2: 10, status: "compatible" },
        updatedAt: "2026-10-12T15:00:00Z",
        venue: null,
      },
      {
        capacityM2: 20,
        clientName: null,
        eventDate: null,
        eventType: null,
        id: "anterior",
        name: "Cumpleaños",
        spaceType: "casa",
        spatial: { availableM2: 20, requiredM2: 0, status: "compatible" },
        updatedAt: "2026-10-11T15:00:00Z",
        venue: null,
      },
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

  it("conserva eventos legacy sin nombre, tipo ni capacidad", async () => {
    const { client } = fakeListClient({
      data: [
        {
          capacity_m2: null,
          id: "legacy",
          name: null,
          package_items: null,
          space_type: null,
          updated_at: "2026-10-10T15:00:00Z",
        },
      ],
      error: null,
    });

    expect(await new SupabasePackageReader(client).listByOwner("user-1")).toEqual(ok([
      {
        capacityM2: null,
        clientName: null,
        eventDate: null,
        eventType: null,
        id: "legacy",
        name: "",
        spaceType: null,
        spatial: { availableM2: null, requiredM2: 0, status: "pending" },
        updatedAt: "2026-10-10T15:00:00Z",
        venue: null,
      },
    ]));
  });
});

function ok<T>(value: T) {
  return { ok: true as const, value };
}
