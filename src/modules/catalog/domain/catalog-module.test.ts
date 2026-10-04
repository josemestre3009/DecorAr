import { describe, expect, it } from "vitest";

import { CatalogModule, type CatalogModuleProps } from "./catalog-module";

describe("CatalogModule domain entity", () => {
  const validDraftProps: CatalogModuleProps = {
    id: "c1000000-0000-4000-8000-000000000001",
    assetId: "mesa",
    version: 1,
    name: "Mesa redonda",
    priceCop: 250000,
    areaM2: 4,
    widthM: null,
    heightM: null,
    depthM: null,
    glbUrl: null,
    usdzUrl: null,
    posterUrl: null,
    status: "draft",
  };

  const validActiveProps: CatalogModuleProps = {
    id: "c1000000-0000-4000-8000-000000000001",
    assetId: "mesa",
    version: 1,
    name: "Mesa redonda",
    priceCop: 250000,
    areaM2: 4,
    widthM: 2,
    heightM: 1,
    depthM: 2,
    glbUrl: "https://example.com/mesa.glb",
    usdzUrl: "https://example.com/mesa.usdz",
    posterUrl: "https://example.com/mesa.webp",
    status: "active",
  };

  it("creates a valid draft module with empty 3D links and dimensions", () => {
    const result = CatalogModule.create(validDraftProps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe(validDraftProps.id);
    expect(result.value.assetId).toBe("mesa");
    expect(result.value.version).toBe(1);
    expect(result.value.name).toBe("Mesa redonda");
    expect(result.value.priceCop).toBe(250000);
    expect(result.value.areaM2).toBe(4);
    expect(result.value.widthM).toBeNull();
    expect(result.value.heightM).toBeNull();
    expect(result.value.depthM).toBeNull();
    expect(result.value.glbUrl).toBeNull();
    expect(result.value.usdzUrl).toBeNull();
    expect(result.value.posterUrl).toBeNull();
    expect(result.value.status).toBe("draft");
    expect(result.value.isActive()).toBe(false);
  });

  it("creates a valid active module when all 3D assets and dimensions are present", () => {
    const result = CatalogModule.create(validActiveProps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("active");
    expect(result.value.isActive()).toBe(true);
    expect(result.value.glbUrl).toBe("https://example.com/mesa.glb");
    expect(result.value.usdzUrl).toBe("https://example.com/mesa.usdz");
    expect(result.value.widthM).toBe(2);
    expect(result.value.heightM).toBe(1);
    expect(result.value.depthM).toBe(2);
  });

  it("rejects an active module missing glbUrl", () => {
    const result = CatalogModule.create({
      ...validActiveProps,
      glbUrl: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.active_missing_glb");
  });

  it("rejects an active module missing usdzUrl", () => {
    const result = CatalogModule.create({
      ...validActiveProps,
      usdzUrl: "   ",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("catalog.active_missing_usdz");
  });

  it("rejects an active module missing any dimension", () => {
    const withoutWidth = CatalogModule.create({
      ...validActiveProps,
      widthM: null,
    });
    expect(withoutWidth.ok).toBe(false);
    if (!withoutWidth.ok) {
      expect(withoutWidth.error.code).toBe("catalog.active_missing_dimensions");
    }

    const withoutHeight = CatalogModule.create({
      ...validActiveProps,
      heightM: null,
    });
    expect(withoutHeight.ok).toBe(false);

    const withoutDepth = CatalogModule.create({
      ...validActiveProps,
      depthM: null,
    });
    expect(withoutDepth.ok).toBe(false);
  });

  it("rejects non-positive priceCop", () => {
    const zeroPrice = CatalogModule.create({
      ...validDraftProps,
      priceCop: 0,
    });
    expect(zeroPrice.ok).toBe(false);
    if (!zeroPrice.ok) {
      expect(zeroPrice.error.code).toBe("catalog.invalid_price");
    }

    const negativePrice = CatalogModule.create({
      ...validDraftProps,
      priceCop: -50,
    });
    expect(negativePrice.ok).toBe(false);

    const nonIntegerPrice = CatalogModule.create({
      ...validDraftProps,
      priceCop: 100.5,
    });
    expect(nonIntegerPrice.ok).toBe(false);
  });

  it("rejects non-positive areaM2", () => {
    const zeroArea = CatalogModule.create({
      ...validDraftProps,
      areaM2: 0,
    });
    expect(zeroArea.ok).toBe(false);
    if (!zeroArea.ok) {
      expect(zeroArea.error.code).toBe("catalog.invalid_area");
    }

    const negativeArea = CatalogModule.create({
      ...validDraftProps,
      areaM2: -2.5,
    });
    expect(negativeArea.ok).toBe(false);
  });

  it("rejects non-positive dimensions when provided", () => {
    const zeroDimension = CatalogModule.create({
      ...validDraftProps,
      widthM: 0,
    });
    expect(zeroDimension.ok).toBe(false);
    if (!zeroDimension.ok) {
      expect(zeroDimension.error.code).toBe("catalog.invalid_dimension");
    }
  });

  it("rejects empty id, assetId, name or invalid version", () => {
    expect(CatalogModule.create({ ...validDraftProps, id: "" }).ok).toBe(false);
    expect(CatalogModule.create({ ...validDraftProps, assetId: "" }).ok).toBe(false);
    expect(CatalogModule.create({ ...validDraftProps, name: "  " }).ok).toBe(false);
    expect(CatalogModule.create({ ...validDraftProps, version: 0 }).ok).toBe(false);
  });
});
