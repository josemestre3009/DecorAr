import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createSupabasePackageSnapshotReader } from "./supabase-package-snapshot-reader";

vi.mock("server-only", () => ({}));

function clientWith(packageResult: { data: unknown; error: unknown }, itemsResult: { data: unknown; error: unknown }) {
  const packageQuery = {
    select: vi.fn(() => packageQuery),
    eq: vi.fn(() => packageQuery),
    maybeSingle: vi.fn(async () => packageResult),
  };
  const itemsQuery = {
    select: vi.fn(() => itemsQuery),
    eq: vi.fn(async () => itemsResult),
  };
  const from = vi.fn((table: string) => (table === "packages" ? packageQuery : itemsQuery));
  const client = { from } as unknown as SupabaseClient;

  return { client, from, packageQuery, itemsQuery };
}

describe("createSupabasePackageSnapshotReader", () => {
  it("lee la versión del paquete y mapea cada item a una hoja con su priceCop", async () => {
    const { client, from } = clientWith(
      { data: { version: 3 }, error: null },
      {
        data: [
          { catalog_modules: { price_cop: 250000 } },
          { catalog_modules: { price_cop: 200000 } },
        ],
        error: null,
      },
    );

    const result = await createSupabasePackageSnapshotReader(client).read("pkg-1");

    expect(from).toHaveBeenCalledWith("packages");
    expect(from).toHaveBeenCalledWith("package_items");
    expect(result).toEqual({
      ok: true,
      value: {
        packageId: "pkg-1",
        packageVersion: 3,
        nodes: [
          { kind: "leaf", priceCop: 250000 },
          { kind: "leaf", priceCop: 200000 },
        ],
      },
    });
  });

  it("devuelve null cuando el paquete no existe", async () => {
    const { client } = clientWith({ data: null, error: null }, { data: [], error: null });

    const result = await createSupabasePackageSnapshotReader(client).read("pkg-missing");

    expect(result).toEqual({ ok: true, value: null });
  });

  it("un paquete sin items produce un snapshot sin nodos", async () => {
    const { client } = clientWith({ data: { version: 1 }, error: null }, { data: [], error: null });

    const result = await createSupabasePackageSnapshotReader(client).read("pkg-empty");

    expect(result).toEqual({ ok: true, value: { packageId: "pkg-empty", packageVersion: 1, nodes: [] } });
  });

  it("propaga un error de lectura del paquete como package.persistence_error", async () => {
    const { client } = clientWith({ data: null, error: { message: "boom" } }, { data: [], error: null });

    const result = await createSupabasePackageSnapshotReader(client).read("pkg-1");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("package.persistence_error");
  });

  it("propaga un error de lectura de los items como package.persistence_error", async () => {
    const { client } = clientWith({ data: { version: 1 }, error: null }, { data: null, error: { message: "boom" } });

    const result = await createSupabasePackageSnapshotReader(client).read("pkg-1");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("package.persistence_error");
  });
});
