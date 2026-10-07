import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parsePublishOptions } from "./publish-catalog-assets";

describe("parsePublishOptions", () => {
  it("selecciona un módulo y una versión nueva", () => {
    expect(parsePublishOptions(["--asset=mesa", "--version=2"])).toEqual({
      assetId: "mesa",
      version: 2,
    });
  });

  it("rechaza módulos y versiones inválidas", () => {
    expect(() => parsePublishOptions(["--asset=silla"])).toThrow("Módulo desconocido");
    expect(() => parsePublishOptions(["--version=0"])).toThrow("Versión inválida");
  });
});
