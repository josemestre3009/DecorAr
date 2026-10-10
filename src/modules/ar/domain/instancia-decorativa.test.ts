import { describe, expect, it } from "vitest";

import { crearActivo3DCompartido } from "./activo-3d-compartido";
import { InstanciaDecorativa } from "./instancia-decorativa";

const activoResultado = crearActivo3DCompartido({
  assetId: "pista",
  depthM: 4,
  glbUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/pista/v2/pista.glb",
  heightM: 0.29,
  posterUrl: null,
  usdzUrl: "https://res.cloudinary.com/demo/raw/upload/decorar/pista/v2/pista.usdz",
  version: 2,
  widthM: 4,
});

if (!activoResultado.ok) throw activoResultado.error;
const activo = activoResultado.value;

function crear(estado?: Parameters<typeof InstanciaDecorativa.crear>[1]) {
  const resultado = InstanciaDecorativa.crear(activo, estado);
  if (!resultado.ok) throw resultado.error;

  return resultado.value;
}

describe("InstanciaDecorativa (estado extrínseco del Flyweight)", () => {
  it("empieza en el origen, sin rotación, color original y escala fija 1", () => {
    const instancia = crear();

    expect(instancia.posicion).toEqual({ x: 0, y: 0, z: 0 });
    expect(instancia.rotacionGrados).toBe(0);
    expect(instancia.color).toBeNull();
    expect(instancia.escala).toBe(1);
  });

  it("mover, rotar y colorear crean otra instancia con el mismo activo", () => {
    const original = crear();
    const movida = original.mover({ x: 1.5, y: 0, z: -2 });
    const rotada = original.rotar(90);
    const coloreada = original.colorear("#D7EF74");

    if (!movida.ok || !rotada.ok || !coloreada.ok) throw new Error("se esperaban cambios válidos");

    expect(movida.value.posicion).toEqual({ x: 1.5, y: 0, z: -2 });
    expect(rotada.value.rotacionGrados).toBe(90);
    expect(coloreada.value.color).toBe("#d7ef74");

    for (const copia of [movida.value, rotada.value, coloreada.value]) {
      expect(copia).not.toBe(original);
      expect(copia.activo).toBe(original.activo);
    }

    // La original no cambió.
    expect(original.posicion).toEqual({ x: 0, y: 0, z: 0 });
    expect(original.rotacionGrados).toBe(0);
    expect(original.color).toBeNull();
  });

  it("dos instancias del mismo activo no se afectan entre sí", () => {
    const a = crear({ posicion: { x: 1, y: 0, z: 0 } });
    const b = crear({ posicion: { x: 5, y: 0, z: 3 }, rotacionGrados: 45 });

    expect(a.activo).toBe(b.activo);
    expect(a.posicion).not.toEqual(b.posicion);
    expect(a.rotacionGrados).not.toBe(b.rotacionGrados);
  });

  it("normaliza la rotación a [0, 360)", () => {
    expect(crear({ rotacionGrados: 450 }).rotacionGrados).toBe(90);
    expect(crear({ rotacionGrados: -90 }).rotacionGrados).toBe(270);
    expect(crear({ rotacionGrados: -360 }).rotacionGrados).toBe(0);

    const vueltaCompleta = crear({ rotacionGrados: 300 }).rotar(60);
    expect(vueltaCompleta.ok && vueltaCompleta.value.rotacionGrados).toBe(0);
  });

  it("su estado no se puede mutar desde fuera", () => {
    const instancia = crear({ posicion: { x: 1, y: 2, z: 3 } });

    expect(Object.isFrozen(instancia.posicion)).toBe(true);
    expect(() => {
      (instancia.posicion as { x: number }).x = 99;
    }).toThrow(TypeError);
  });

  it.each([
    ["posición NaN", { posicion: { x: Number.NaN, y: 0, z: 0 } }, "ar.invalid_position"],
    ["rotación infinita", { rotacionGrados: Number.POSITIVE_INFINITY }, "ar.invalid_rotation"],
    ["color con nombre", { color: "red" }, "ar.invalid_color"],
    ["color corto", { color: "#fff" }, "ar.invalid_color"],
  ])("rechaza %s", (_caso, estado, codigo) => {
    const resultado = InstanciaDecorativa.crear(activo, estado);

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe(codigo);
  });
});
