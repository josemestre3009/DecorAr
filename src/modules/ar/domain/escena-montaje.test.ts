import { describe, expect, it } from "vitest";

import { EscenaMontaje, type TransformacionItem } from "./escena-montaje";

function item(partial: Partial<TransformacionItem> & { itemId: string }): TransformacionItem {
  return {
    itemId: partial.itemId,
    posicion: partial.posicion ?? { x: 0, y: 0, z: 0 },
    rotacionDeg: partial.rotacionDeg ?? 0,
  };
}

describe("EscenaMontaje (DECOR-46)", () => {
  it("se crea vacía", () => {
    const escena = EscenaMontaje.crear([]);
    if (!escena.ok) throw escena.error;

    expect(escena.value.transformaciones).toEqual([]);
  });

  it("conserva la posición de cada unidad repetida por separado", () => {
    const escena = EscenaMontaje.crear([
      item({ itemId: "a", posicion: { x: 1, y: 0, z: 1 } }),
      item({ itemId: "b", posicion: { x: -1, y: 0, z: -1 } }),
    ]);
    if (!escena.ok) throw escena.error;

    expect(escena.value.transformaciones).toEqual([
      { itemId: "a", posicion: { x: 1, y: 0, z: 1 }, rotacionDeg: 0 },
      { itemId: "b", posicion: { x: -1, y: 0, z: -1 }, rotacionDeg: 0 },
    ]);
  });

  it("normaliza la rotación a [0, 360)", () => {
    const escena = EscenaMontaje.crear([item({ itemId: "a", rotacionDeg: 405 })]);
    if (!escena.ok) throw escena.error;

    expect(escena.value.transformaciones[0].rotacionDeg).toBe(45);
  });

  it("rechaza itemId vacío", () => {
    const escena = EscenaMontaje.crear([item({ itemId: "  " })]);

    expect(escena.ok).toBe(false);
    if (!escena.ok) expect(escena.error.code).toBe("ar.scene_invalid_item");
  });

  it("rechaza itemId duplicado", () => {
    const escena = EscenaMontaje.crear([item({ itemId: "a" }), item({ itemId: "a" })]);

    expect(escena.ok).toBe(false);
    if (!escena.ok) expect(escena.error.code).toBe("ar.scene_duplicate_item");
  });

  it("rechaza posición no finita", () => {
    const escena = EscenaMontaje.crear([item({ itemId: "a", posicion: { x: NaN, y: 0, z: 0 } })]);

    expect(escena.ok).toBe(false);
    if (!escena.ok) expect(escena.error.code).toBe("ar.invalid_position");
  });

  it("rechaza x fuera de [-50, 50]", () => {
    const escena = EscenaMontaje.crear([item({ itemId: "a", posicion: { x: 51, y: 0, z: 0 } })]);

    expect(escena.ok).toBe(false);
    if (!escena.ok) expect(escena.error.code).toBe("ar.scene_position_out_of_bounds");
  });

  it("rechaza z fuera de [-50, 50]", () => {
    const escena = EscenaMontaje.crear([item({ itemId: "a", posicion: { x: 0, y: 0, z: -51 } })]);

    expect(escena.ok).toBe(false);
    if (!escena.ok) expect(escena.error.code).toBe("ar.scene_position_out_of_bounds");
  });

  it("rechaza y fuera de [-1, 5]", () => {
    const escena = EscenaMontaje.crear([item({ itemId: "a", posicion: { x: 0, y: 5.1, z: 0 } })]);

    expect(escena.ok).toBe(false);
    if (!escena.ok) expect(escena.error.code).toBe("ar.scene_position_out_of_bounds");
  });

  it("rechaza rotación no finita", () => {
    const escena = EscenaMontaje.crear([item({ itemId: "a", rotacionDeg: NaN })]);

    expect(escena.ok).toBe(false);
    if (!escena.ok) expect(escena.error.code).toBe("ar.invalid_rotation");
  });

  it("rechaza más de 100 unidades", () => {
    const items = Array.from({ length: 101 }, (_, i) => item({ itemId: `item-${i}` }));
    const escena = EscenaMontaje.crear(items);

    expect(escena.ok).toBe(false);
    if (!escena.ok) expect(escena.error.code).toBe("ar.scene_too_many_items");
  });

  it("acepta exactamente 100 unidades", () => {
    const items = Array.from({ length: 100 }, (_, i) => item({ itemId: `item-${i}` }));
    const escena = EscenaMontaje.crear(items);

    expect(escena.ok).toBe(true);
  });
});
