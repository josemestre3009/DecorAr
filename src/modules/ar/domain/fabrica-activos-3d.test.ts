import { describe, expect, it } from "vitest";

import type { DatosActivo3D } from "./activo-3d-compartido";
import { FabricaActivos3D } from "./fabrica-activos-3d";
import { InstanciaDecorativa } from "./instancia-decorativa";

const MESA_V2: DatosActivo3D = {
  assetId: "mesa",
  depthM: 1.19,
  glbUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v2/mesa.glb",
  heightM: 0.94,
  posterUrl: null,
  usdzUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v2/mesa.usdz",
  version: 2,
  widthM: 2,
};

const ARCO_V2: DatosActivo3D = {
  ...MESA_V2,
  assetId: "arco",
  glbUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/arco/v2/arco.glb",
  usdzUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/arco/v2/arco.usdz",
};

describe("FabricaActivos3D (fábrica del Flyweight)", () => {
  it("una carga para N instancias: 10 mesas comparten el mismo activo", () => {
    const fabrica = new FabricaActivos3D();

    const instancias = Array.from({ length: 10 }, (_, indice) => {
      const activo = fabrica.obtener(MESA_V2);
      if (!activo.ok) throw activo.error;

      const instancia = InstanciaDecorativa.crear(activo.value, {
        posicion: { x: indice, y: 0, z: 0 },
      });
      if (!instancia.ok) throw instancia.error;

      return instancia.value;
    });

    expect(fabrica.activosCreados).toBe(1);
    expect(fabrica.tamano).toBe(1);
    expect(new Set(instancias.map((instancia) => instancia.activo)).size).toBe(1);
    // El estado extrínseco sí es propio de cada copia.
    expect(new Set(instancias.map((instancia) => instancia.posicion.x)).size).toBe(10);
  });

  it("crea un activo distinto por cada assetId", () => {
    const fabrica = new FabricaActivos3D();
    const mesa = fabrica.obtener(MESA_V2);
    const arco = fabrica.obtener(ARCO_V2);

    if (!mesa.ok || !arco.ok) throw new Error("se esperaban activos válidos");

    expect(mesa.value).not.toBe(arco.value);
    expect(fabrica.activosCreados).toBe(2);
  });

  it("separa versiones del mismo assetId: v1 y v2 no se mezclan", () => {
    const fabrica = new FabricaActivos3D();
    const v2 = fabrica.obtener(MESA_V2);
    const v1 = fabrica.obtener({
      ...MESA_V2,
      glbUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/mesa/v1/mesa.glb",
      version: 1,
    });

    if (!v1.ok || !v2.ok) throw new Error("se esperaban activos válidos");

    expect(v1.value).not.toBe(v2.value);
    expect(v1.value.clave).toBe("mesa@v1");
    expect(v2.value.clave).toBe("mesa@v2");
  });

  it("no sobrescribe un activo publicado si llegan otros datos con la misma clave", () => {
    const fabrica = new FabricaActivos3D();
    const original = fabrica.obtener(MESA_V2);
    const conflicto = fabrica.obtener({ ...MESA_V2, widthM: 3 });

    expect(conflicto.ok).toBe(false);
    if (conflicto.ok || !original.ok) return;

    expect(conflicto.error.code).toBe("ar.asset_conflict");

    const otraVez = fabrica.obtener(MESA_V2);
    expect(otraVez.ok && otraVez.value).toBe(original.value);
    expect(otraVez.ok && otraVez.value.widthM).toBe(2);
  });

  it("no guarda en caché un activo inválido", () => {
    const fabrica = new FabricaActivos3D();
    const resultado = fabrica.obtener({ ...MESA_V2, glbUrl: "ftp://example.com/mesa.glb" });

    expect(resultado.ok).toBe(false);
    expect(fabrica.tamano).toBe(0);
    expect(fabrica.activosCreados).toBe(0);
    expect(fabrica.obtener(MESA_V2).ok).toBe(true);
  });

  it("normaliza espacios del assetId para no duplicar el activo", () => {
    const fabrica = new FabricaActivos3D();
    const limpio = fabrica.obtener(MESA_V2);
    const conEspacios = fabrica.obtener({ ...MESA_V2, assetId: " mesa " });

    expect(limpio.ok && conEspacios.ok && limpio.value === conEspacios.value).toBe(true);
    expect(fabrica.activosCreados).toBe(1);
  });
});
