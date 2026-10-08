import { describe, expect, it } from "vitest";

import {
  claveActivo3D,
  crearActivo3DCompartido,
  mismosDatosActivo3D,
  type DatosActivo3D,
} from "./activo-3d-compartido";

const MESA: DatosActivo3D = {
  assetId: "mesa",
  depthM: 1.19,
  glbUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v2/mesa.glb",
  heightM: 0.94,
  posterUrl: "https://res.cloudinary.com/demo/image/upload/decorar/mesa/v2/mesa-poster.webp",
  usdzUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v2/mesa.usdz",
  version: 2,
  widthM: 2,
};

function crear(datos: Partial<DatosActivo3D> = {}) {
  return crearActivo3DCompartido({ ...MESA, ...datos });
}

describe("Activo3DCompartido (flyweight)", () => {
  it("conserva URLs, poster y dimensiones del catálogo con clave assetId+version", () => {
    const resultado = crear();

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.value).toEqual({ ...MESA, clave: "mesa@v2" });
    expect(claveActivo3D("mesa", 2)).toBe("mesa@v2");
  });

  it("es inmutable: no se puede cambiar lo que comparten las instancias", () => {
    const resultado = crear();
    if (!resultado.ok) throw resultado.error;

    expect(Object.isFrozen(resultado.value)).toBe(true);
    expect(() => {
      (resultado.value as { widthM: number }).widthM = 10;
    }).toThrow(TypeError);
    expect(resultado.value.widthM).toBe(2);
  });

  it("acepta un activo sin poster", () => {
    expect(crear({ posterUrl: null }).ok).toBe(true);
  });

  it.each([
    ["assetId vacío", { assetId: "  " }, "ar.invalid_asset_id"],
    ["versión 0", { version: 0 }, "ar.invalid_version"],
    ["versión decimal", { version: 1.5 }, "ar.invalid_version"],
    ["GLB sin HTTPS", { glbUrl: "http://example.com/mesa.glb" }, "ar.invalid_glb_url"],
    ["GLB relativo", { glbUrl: "/models/mesa.glb" }, "ar.invalid_glb_url"],
    ["USDZ vacío", { usdzUrl: "" }, "ar.invalid_usdz_url"],
    ["poster con javascript:", { posterUrl: "javascript:alert(1)" }, "ar.invalid_poster_url"],
    ["ancho 0", { widthM: 0 }, "ar.invalid_dimension"],
    ["alto negativo", { heightM: -1 }, "ar.invalid_dimension"],
    ["fondo NaN", { depthM: Number.NaN }, "ar.invalid_dimension"],
    ["ancho infinito", { widthM: Number.POSITIVE_INFINITY }, "ar.invalid_dimension"],
  ])("rechaza %s", (_caso, datos, codigo) => {
    const resultado = crear(datos);

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe(codigo);
  });

  it("compara todos los campos intrínsecos", () => {
    const resultado = crear();
    if (!resultado.ok) throw resultado.error;

    expect(mismosDatosActivo3D(resultado.value, MESA)).toBe(true);
    expect(mismosDatosActivo3D(resultado.value, { ...MESA, depthM: 1.2 })).toBe(false);
    expect(mismosDatosActivo3D(resultado.value, { ...MESA, usdzUrl: `${MESA.usdzUrl}?x` })).toBe(false);
  });
});
