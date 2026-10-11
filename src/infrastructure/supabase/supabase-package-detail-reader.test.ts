import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabasePackageDetailReader } from "./supabase-package-detail-reader";

type QueryResult = { data: unknown; error: unknown };

/**
 * Cliente falso: `packages` termina en `maybeSingle()`, `package_items` y
 * `package_groups` en `order()`. Registra los filtros `eq` de cada tabla.
 */
function fakeClient(results: Record<string, QueryResult>) {
  const filters: Record<string, [string, unknown][]> = {};
  const from = vi.fn((table: string) => {
    filters[table] = [];
    const chain = {
      eq: (column: string, value: unknown) => {
        filters[table].push([column, value]);
        return chain;
      },
      maybeSingle: () => Promise.resolve(results[table]),
      order: () => Promise.resolve(results[table]),
      select: () => chain,
    };
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, filters, from };
}

const PACKAGE_ROW = { capacity_m2: "30.00", id: "pkg-1", space_type: "casa", version: 3 };

describe("SupabasePackageDetailReader", () => {
  it("lee el paquete del dueño con sus ítems (nombre, precio y área del catálogo) y grupos", async () => {
    const { client, filters } = fakeClient({
      package_groups: { data: [{ id: "zona", name: "Zona de bienvenida", parent_group_id: null }], error: null },
      package_items: {
        data: [
          {
            catalog_modules: { area_m2: "2.00", name: "Arco floral", price_cop: 200000 },
            group_id: "zona",
            id: "i-arco",
            module_id: "mod-arco",
          },
          {
            catalog_modules: [{ area_m2: 16, name: "Pista de baile", price_cop: "600000" }],
            group_id: null,
            id: "i-pista",
            module_id: "mod-pista",
          },
        ],
        error: null,
      },
      packages: { data: PACKAGE_ROW, error: null },
    });

    const result = await new SupabasePackageDetailReader(client).getDetail("pkg-1", "user-1");

    expect(filters.packages).toEqual([
      ["id", "pkg-1"],
      ["user_id", "user-1"],
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        capacityM2: 30,
        groups: [{ groupId: "zona", name: "Zona de bienvenida", parentGroupId: null }],
        id: "pkg-1",
        items: [
          { areaM2: 2, groupId: "zona", itemId: "i-arco", moduleId: "mod-arco", name: "Arco floral", priceCop: 200000 },
          {
            areaM2: 16,
            groupId: null,
            itemId: "i-pista",
            moduleId: "mod-pista",
            name: "Pista de baile",
            priceCop: 600000,
          },
        ],
        spaceType: "casa",
        version: 3,
      },
    });
  });

  it("paquete ajeno, inexistente o con id mal formado devuelve null", async () => {
    const missing = fakeClient({ packages: { data: null, error: null } });
    expect(await new SupabasePackageDetailReader(missing.client).getDetail("pkg-x", "user-1")).toEqual({
      ok: true,
      value: null,
    });
    expect(missing.from).toHaveBeenCalledTimes(1);

    const malformed = fakeClient({ packages: { data: null, error: { code: "22P02", message: "invalid uuid" } } });
    expect(await new SupabasePackageDetailReader(malformed.client).getDetail("no-uuid", "user-1")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("un módulo sin datos de catálogo no rompe la lectura", async () => {
    const { client } = fakeClient({
      package_groups: { data: [], error: null },
      package_items: { data: [{ catalog_modules: null, group_id: null, id: "i-1", module_id: "m-1" }], error: null },
      packages: { data: PACKAGE_ROW, error: null },
    });

    const result = await new SupabasePackageDetailReader(client).getDetail("pkg-1", "user-1");

    expect(result.ok && result.value?.items[0]).toEqual({
      areaM2: 0,
      groupId: null,
      itemId: "i-1",
      moduleId: "m-1",
      name: "Módulo no disponible",
      priceCop: 0,
    });
  });

  it.each(["packages", "package_items", "package_groups"])(
    "un error al leer %s devuelve package.persistence_error",
    async (failingTable) => {
      const results: Record<string, QueryResult> = {
        package_groups: { data: [], error: null },
        package_items: { data: [], error: null },
        packages: { data: PACKAGE_ROW, error: null },
      };
      results[failingTable] = { data: null, error: { code: "XX000", message: "boom" } };
      const { client } = fakeClient(results);

      const result = await new SupabasePackageDetailReader(client).getDetail("pkg-1", "user-1");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.persistence_error");
    },
  );

  it("una excepción del cliente se convierte en package.persistence_error", async () => {
    const client = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;

    const result = await new SupabasePackageDetailReader(client).getDetail("pkg-1", "user-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.persistence_error");
  });
});
