import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_CATALOG_ASSET_VERSION, parsePublishOptions } from "./publish-catalog-assets";

describe("parsePublishOptions", () => {
  it("usa v2 como versión corregida por defecto", () => {
    expect(DEFAULT_CATALOG_ASSET_VERSION).toBe(2);
  });

  it("selecciona un módulo y una versión nueva", () => {
    expect(parsePublishOptions(["--asset=mesa", "--version=2"])).toEqual({
      assetId: "mesa",
      version: 2,
    });
  });

  it("permite publicar la silla", () => {
    expect(parsePublishOptions(["--asset=silla", "--version=2"])).toEqual({
      assetId: "silla",
      version: 2,
    });
  });

  it("rechaza módulos y versiones inválidas", () => {
    expect(() => parsePublishOptions(["--asset=lampara"])).toThrow("Módulo desconocido");
    expect(() => parsePublishOptions(["--version=0"])).toThrow("Versión inválida");
  });
});
