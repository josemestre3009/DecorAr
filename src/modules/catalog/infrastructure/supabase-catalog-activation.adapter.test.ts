import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseCatalogActivationAdapter } from "./supabase-catalog-activation.adapter";

describe("SupabaseCatalogActivationAdapter", () => {
  const mockParams = {
    assetId: "mesa",
    version: 1,
    glbUrl: "https://example.com/mesa.glb",
    usdzUrl: "https://example.com/mesa.usdz",
    posterUrl: "https://example.com/mesa.webp",
    widthM: 2.0,
    heightM: 1.0,
    depthM: 2.0,
  };

  it("invoca RPC activate_catalog_module y retorna CatalogModule activo", async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          id: "33333333-3333-4000-8000-333333333333",
          asset_id: "mesa",
          version: 1,
          name: "Mesa redonda",
          price_cop: 250000,
          area_m2: "4.00",
          width_m: "2.00",
          height_m: "1.00",
          depth_m: "2.00",
          glb_url: "https://example.com/mesa.glb",
          usdz_url: "https://example.com/mesa.usdz",
          poster_url: "https://example.com/mesa.webp",
          status: "active",
        },
        error: null,
      }),
    } as unknown as SupabaseClient;

    const adapter = new SupabaseCatalogActivationAdapter(mockClient);
    const result = await adapter.activateModule(mockParams);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("active");
    expect(result.value.assetId).toBe("mesa");
    expect(result.value.glbUrl).toBe("https://example.com/mesa.glb");
    expect(mockClient.rpc).toHaveBeenCalledWith("activate_catalog_module", {
      p_asset_id: "mesa",
      p_version: 1,
      p_glb_url: "https://example.com/mesa.glb",
      p_usdz_url: "https://example.com/mesa.usdz",
      p_poster_url: "https://example.com/mesa.webp",
      p_width_m: 2.0,
      p_height_m: 1.0,
      p_depth_m: 2.0,
    });
  });

  it("retorna DomainError cuando la RPC de Supabase responde con error", async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Catalog module with asset_id mesa and version 1 not found" },
      }),
    } as unknown as SupabaseClient;

    const adapter = new SupabaseCatalogActivationAdapter(mockClient);
    const result = await adapter.activateModule(mockParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("catalog.activation_error");
    expect(result.error.message).toContain("not found");
  });

  it("propaga DomainError cuando la RPC arroja que el módulo no está en draft status", async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message:
            "Catalog module with asset_id mesa and version 1 is not in draft status (current status: active)",
        },
      }),
    } as unknown as SupabaseClient;

    const adapter = new SupabaseCatalogActivationAdapter(mockClient);
    const result = await adapter.activateModule(mockParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("catalog.activation_error");
    expect(result.error.message).toContain("is not in draft status");
  });

  it("retorna DomainError si la RPC no devuelve datos", async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    } as unknown as SupabaseClient;

    const adapter = new SupabaseCatalogActivationAdapter(mockClient);
    const result = await adapter.activateModule(mockParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("catalog.activation_missing_data");
  });

  it("retorna DomainError si los datos retornados por la RPC no conforman una entidad válida", async () => {
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          id: "33333333-3333-4000-8000-333333333333",
          asset_id: "mesa",
          version: 1,
          name: "Mesa redonda",
          price_cop: -100, // precio inválido
          area_m2: "4.00",
          width_m: "2.00",
          height_m: "1.00",
          depth_m: "2.00",
          status: "active",
        },
        error: null,
      }),
    } as unknown as SupabaseClient;

    const adapter = new SupabaseCatalogActivationAdapter(mockClient);
    const result = await adapter.activateModule(mockParams);

    expect(result.ok).toBe(false);
  });

  it("retorna DomainError cuando la llamada a la RPC arroja una excepción de red inesperada", async () => {
    const mockClient = {
      rpc: vi.fn().mockRejectedValue(new Error("Network connection dropped")),
    } as unknown as SupabaseClient;

    const adapter = new SupabaseCatalogActivationAdapter(mockClient);
    const result = await adapter.activateModule(mockParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("catalog.unexpected_activation_error");
    expect(result.error.message).toContain("Network connection dropped");
  });
});
