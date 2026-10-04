import { describe, expect, it, vi } from "vitest";

import { SupabaseCatalogRepository, type CatalogModuleRow } from "./supabase-catalog-repository";

vi.mock("server-only", () => ({}));

describe("SupabaseCatalogRepository", () => {
  it("queries active catalog modules and maps to domain entities", async () => {
    const mockRows: CatalogModuleRow[] = [
      {
        id: "c1000000-0000-4000-8000-000000000001",
        asset_id: "mesa",
        version: 1,
        name: "Mesa redonda",
        price_cop: 250000,
        area_m2: 4,
        width_m: 2,
        height_m: 1,
        depth_m: 2,
        glb_url: "https://example.com/mesa.glb",
        usdz_url: "https://example.com/mesa.usdz",
        poster_url: "https://example.com/mesa.webp",
        status: "active",
      },
    ];

    const mockOrder = vi.fn().mockResolvedValue({ data: mockRows, error: null });
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    const mockClient = { from: mockFrom } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const repository = new SupabaseCatalogRepository(mockClient);
    const result = await repository.getActiveModules();

    expect(mockFrom).toHaveBeenCalledWith("catalog_modules");
    expect(mockEq).toHaveBeenCalledWith("status", "active");
    expect(mockOrder).toHaveBeenCalledWith("name", { ascending: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe("c1000000-0000-4000-8000-000000000001");
    expect(result.value[0].assetId).toBe("mesa");
    expect(result.value[0].priceCop).toBe(250000);
    expect(result.value[0].isActive()).toBe(true);
  });

  it("returns domain error when Supabase client reports an error", async () => {
    const mockOrder = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "connection timeout", code: "PGRST000" },
    });
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    const mockClient = { from: mockFrom } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const repository = new SupabaseCatalogRepository(mockClient);
    const result = await repository.getActiveModules();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.persistence_error");
    expect(result.error.message).toBe("connection timeout");
  });

  it("returns domain error when row data violates domain invariants", async () => {
    const invalidRows: CatalogModuleRow[] = [
      {
        id: "c1000000-0000-4000-8000-000000000001",
        asset_id: "mesa",
        version: 1,
        name: "Mesa redonda",
        price_cop: -10, // Invalid price in DB
        area_m2: 4,
        width_m: 2,
        height_m: 1,
        depth_m: 2,
        glb_url: "https://example.com/mesa.glb",
        usdz_url: "https://example.com/mesa.usdz",
        poster_url: "https://example.com/mesa.webp",
        status: "active",
      },
    ];

    const mockOrder = vi.fn().mockResolvedValue({ data: invalidRows, error: null });
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    const mockClient = { from: mockFrom } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const repository = new SupabaseCatalogRepository(mockClient);
    const result = await repository.getActiveModules();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.invalid_price");
  });
});
