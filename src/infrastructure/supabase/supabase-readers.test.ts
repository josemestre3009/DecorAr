import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseCatalogModuleReader } from "./supabase-catalog-module-reader";
import { SupabasePackageReader } from "./supabase-package-reader";

const INVALID_UUID = {
  code: "22P02",
  details: null,
  hint: null,
  message: "invalid input syntax for type uuid",
};

interface QueryStub {
  eq(column: string, value: unknown): QueryStub;
  maybeSingle(): Promise<unknown>;
}

function clientReturning(response: unknown): SupabaseClient {
  const query: QueryStub = {
    eq: () => query,
    maybeSingle: vi.fn().mockResolvedValue(response),
  };

  return {
    from: () => ({ select: () => query }),
  } as unknown as SupabaseClient;
}

describe("Supabase readers: id malformado (22P02)", () => {
  it("catálogo: un módulo con id no-UUID se trata como no encontrado", async () => {
    const reader = new SupabaseCatalogModuleReader(
      clientReturning({ data: null, error: INVALID_UUID }),
    );

    const result = await reader.getModuleById("no-es-uuid");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("paquete: un elemento con id no-UUID se trata como no encontrado", async () => {
    const reader = new SupabasePackageReader(
      clientReturning({ data: null, error: INVALID_UUID }),
    );

    const result = await reader.getItemModuleId(
      "11111111-1111-4111-8111-111111111111",
      "no-es-uuid",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });
});
