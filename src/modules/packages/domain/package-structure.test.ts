import { describe, expect, it } from "vitest";
import { CATALOGO_CANONICO } from "./catalog-fixtures";
import { ModuloCompuesto } from "./composite-module";
import { reconstruirComponentes } from "./package-structure";

const mesa = CATALOGO_CANONICO.mesaRedonda;
const arco = CATALOGO_CANONICO.arcoFloral;

describe("reconstruirComponentes: árbol Composite desde filas guardadas", () => {
  it("arma grupos anidados y hojas en la raíz o dentro de su grupo, sin importar el orden", () => {
    const result = reconstruirComponentes(
      [
        { grupoPadreId: "zona", id: "sub", nombre: "Mesa de regalos" },
        { grupoPadreId: null, id: "zona", nombre: "Zona de bienvenida" },
      ],
      [
        { grupoId: "zona", modulo: arco },
        { grupoId: "sub", modulo: mesa },
        { grupoId: null, modulo: mesa },
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(2);
    const zona = result.value.find((c) => c.id === "zona") as ModuloCompuesto;
    expect(zona.profundidad()).toBe(2);
    expect(zona.calcularPrecio()).toBe(arco.precio + mesa.precio);
    expect(result.value.reduce((acc, c) => acc + c.calcularAreaM2(), 0)).toBe(10);
  });

  it("rechaza un ciclo en los datos guardados", () => {
    const result = reconstruirComponentes(
      [
        { grupoPadreId: "b", id: "a", nombre: "A" },
        { grupoPadreId: "a", id: "b", nombre: "B" },
      ],
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_cycle");
  });

  it("rechaza más de tres niveles guardados", () => {
    const result = reconstruirComponentes(
      [
        { grupoPadreId: null, id: "1", nombre: "1" },
        { grupoPadreId: "1", id: "2", nombre: "2" },
        { grupoPadreId: "2", id: "3", nombre: "3" },
        { grupoPadreId: "3", id: "4", nombre: "4" },
      ],
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_depth_exceeded");
  });

  it("rechaza un padre o un grupo de hoja inexistentes", () => {
    const padre = reconstruirComponentes([{ grupoPadreId: "x", id: "a", nombre: "A" }], []);
    expect(padre.ok).toBe(false);
    if (!padre.ok) expect(padre.error.code).toBe("package.group_not_found");

    const hoja = reconstruirComponentes([], [{ grupoId: "x", modulo: mesa }]);
    expect(hoja.ok).toBe(false);
    if (!hoja.ok) expect(hoja.error.code).toBe("package.group_not_found");
  });
});
