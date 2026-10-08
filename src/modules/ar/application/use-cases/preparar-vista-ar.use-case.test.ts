import { describe, expect, it } from "vitest";

import { ArcoAR, MesaAR, PistaAR } from "../../domain/elemento-ar";
import { FabricaActivos3D } from "../../domain/fabrica-activos-3d";
import { PrepararVistaARUseCase, type ModuloParaAR } from "./preparar-vista-ar.use-case";

function modulo(assetId: string, extra: Partial<ModuloParaAR> = {}): ModuloParaAR {
  return {
    assetId,
    depthM: 1.19,
    glbUrl: `https://res.cloudinary.com/demo/raw/upload/decorar/${assetId}/v2/${assetId}.glb`,
    heightM: 0.94,
    name: `Módulo ${assetId}`,
    posterUrl: `https://res.cloudinary.com/demo/image/upload/decorar/${assetId}/v2/poster.webp`,
    usdzUrl: `https://res.cloudinary.com/demo/raw/upload/decorar/${assetId}/v2/${assetId}.usdz`,
    version: 2,
    widthM: 2,
    ...extra,
  };
}

const IOS = { plataforma: "ios", webxr: false } as const;
const ANDROID = { plataforma: "android", webxr: true } as const;

describe("PrepararVistaARUseCase", () => {
  it.each([
    ["mesa", MesaAR],
    ["arco", ArcoAR],
    ["pista", PistaAR],
  ] as const)("prepara %s completo para AR en iOS", (assetId, Clase) => {
    const vista = new PrepararVistaARUseCase(new FabricaActivos3D()).execute(modulo(assetId), IOS);

    expect(vista.ok).toBe(true);
    if (!vista.ok) return;

    expect(vista.value.elemento).toBeInstanceOf(Clase);
    expect(vista.value.configuracion).toMatchObject({
      ar: true,
      arPlacement: "floor",
      arScale: "fixed",
      iosSrc: modulo(assetId).usdzUrl,
      renderizador: "quick-look",
      src: modulo(assetId).glbUrl,
    });
  });

  it("el mismo módulo usa Scene Viewer en Android", () => {
    const vista = new PrepararVistaARUseCase(new FabricaActivos3D()).execute(modulo("mesa"), ANDROID);

    expect(vista.ok && vista.value.configuracion.renderizador).toBe("scene-viewer");
  });

  it("reutiliza el activo compartido entre vistas del mismo módulo", () => {
    const fabrica = new FabricaActivos3D();
    const casoDeUso = new PrepararVistaARUseCase(fabrica);

    const primera = casoDeUso.execute(modulo("mesa"), IOS);
    const segunda = casoDeUso.execute(modulo("mesa"), ANDROID);

    if (!primera.ok || !segunda.ok) throw new Error("se esperaban vistas válidas");

    expect(primera.value.elemento.instancia).not.toBe(segunda.value.elemento.instancia);
    expect(primera.value.elemento.instancia.activo).toBe(segunda.value.elemento.instancia.activo);
    expect(fabrica.activosCreados).toBe(1);
  });

  it("propaga el error de un activo sin USDZ válido", () => {
    const vista = new PrepararVistaARUseCase(new FabricaActivos3D()).execute(
      modulo("mesa", { usdzUrl: "" }),
      IOS,
    );

    expect(vista.ok).toBe(false);
    if (vista.ok) return;
    expect(vista.error.code).toBe("ar.invalid_usdz_url");
  });

  it("rechaza un módulo sin nombre", () => {
    const vista = new PrepararVistaARUseCase(new FabricaActivos3D()).execute(
      modulo("mesa", { name: "   " }),
      IOS,
    );

    expect(vista.ok).toBe(false);
    if (vista.ok) return;
    expect(vista.error.code).toBe("ar.invalid_name");
  });

  it("informa cuando el módulo no tiene elemento AR", () => {
    const vista = new PrepararVistaARUseCase(new FabricaActivos3D()).execute(modulo("silla"), IOS);

    expect(vista.ok).toBe(false);
    if (vista.ok) return;
    expect(vista.error.code).toBe("ar.unsupported_element");
  });
});
