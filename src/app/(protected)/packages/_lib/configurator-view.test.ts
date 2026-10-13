import { describe, expect, it } from "vitest";

import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";

import { countUnitsByModule, rowSubtotal, spaceTypeLabel, spatialDiagnosticText, toContentRows } from "./configurator-view";

const leaf = (itemId: string, moduleId: string, name: string, areaM2: number, priceCop: number): PackageDetailNode => ({
  areaM2,
  itemId,
  kind: "leaf",
  moduleId,
  name,
  priceCop,
});

describe("toContentRows", () => {
  it("agrupa unidades del mismo módulo y conserva el orden", () => {
    const rows = toContentRows([
      leaf("a", "pista", "Pista de baile", 16, 600000),
      leaf("b", "mesa", "Mesa redonda", 4, 250000),
      leaf("c", "pista", "Pista de baile", 16, 600000),
    ]);

    expect(rows).toEqual([
      { itemIds: ["a", "c"], kind: "leaves", moduleId: "pista", name: "Pista de baile", unitAreaM2: 16, unitPriceCop: 600000 },
      { itemIds: ["b"], kind: "leaves", moduleId: "mesa", name: "Mesa redonda", unitAreaM2: 4, unitPriceCop: 250000 },
    ]);
    expect(rowSubtotal(rows[0])).toEqual({ areaM2: 32, priceCop: 1200000 });
  });

  it("cada grupo es una fila con sus hijos agrupados y su número de unidades", () => {
    const rows = toContentRows([
      {
        areaM2: 10,
        children: [
          leaf("a", "arco", "Arco floral", 2, 200000),
          leaf("b", "mesa", "Mesa redonda", 4, 250000),
          leaf("c", "mesa", "Mesa redonda", 4, 250000),
        ],
        groupId: "zona",
        kind: "group",
        name: "Zona de bienvenida",
        priceCop: 700000,
      },
    ]);

    expect(rows).toHaveLength(1);
    const [zona] = rows;
    expect(zona).toMatchObject({ areaM2: 10, groupId: "zona", kind: "group", leafCount: 3, priceCop: 700000 });
    if (zona.kind !== "group") return;
    expect(zona.children.map((child) => (child.kind === "leaves" ? child.itemIds.length : 0))).toEqual([1, 2]);
    expect(rowSubtotal(zona)).toEqual({ areaM2: 10, priceCop: 700000 });
  });

  it("no mezcla el mismo módulo de la raíz con el de un grupo", () => {
    const rows = toContentRows([
      leaf("a", "mesa", "Mesa redonda", 4, 250000),
      {
        areaM2: 4,
        children: [leaf("b", "mesa", "Mesa redonda", 4, 250000)],
        groupId: "g",
        kind: "group",
        name: "Grupo",
        priceCop: 250000,
      },
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["leaves", "group"]);
    expect(rows[0].kind === "leaves" && rows[0].itemIds).toEqual(["a"]);
  });

  it("redondea el subtotal de área", () => {
    const [row] = toContentRows([leaf("a", "m", "M", 0.1, 1), leaf("b", "m", "M", 0.1, 1), leaf("c", "m", "M", 0.1, 1)]);
    expect(rowSubtotal(row).areaM2).toBe(0.3);
  });
});

describe("countUnitsByModule", () => {
  it("cuenta las unidades por módulo, incluidas las de grupos anidados", () => {
    const counts = countUnitsByModule([
      leaf("a", "pista", "Pista de baile", 16, 600000),
      leaf("b", "pista", "Pista de baile", 16, 600000),
      {
        areaM2: 4,
        children: [
          {
            areaM2: 4,
            children: [leaf("c", "mesa", "Mesa redonda", 4, 250000)],
            groupId: "g2",
            kind: "group",
            name: "Nivel 2",
            priceCop: 250000,
          },
        ],
        groupId: "g1",
        kind: "group",
        name: "Nivel 1",
        priceCop: 250000,
      },
      { areaM2: 0, children: [], groupId: "vacio", kind: "group", name: "Vacío", priceCop: 0 },
    ]);

    expect(counts).toEqual({ mesa: 1, pista: 2 });
  });

  it("devuelve un mapa vacío para un paquete sin elementos", () => {
    expect(countUnitsByModule([])).toEqual({});
  });
});

describe("spaceTypeLabel", () => {
  it("usa la etiqueta descriptiva del espacio", () => {
    expect(spaceTypeLabel("aireLibre")).toBe("Aire libre (parque o playa)");
    expect(spaceTypeLabel("salonSocial")).toBe("Salón social");
    expect(spaceTypeLabel("desconocido")).toBe("desconocido");
  });

  it("etiqueta la ausencia de espacio", () => {
    expect(spaceTypeLabel(null)).toBe("Sin definir");
  });
});

describe("spatialDiagnosticText (DECOR-44)", () => {
  it("declara pendiente sin área disponible", () => {
    const text = spatialDiagnosticText({ availableM2: null, requiredM2: 12, status: "pending" });

    expect(text.title).toBe("Compatibilidad espacial pendiente");
    expect(text.tone).toBe("neutral");
    expect(text.detail).toContain("12 m² requeridos");
  });

  it("declara compatible con ambas medidas", () => {
    const text = spatialDiagnosticText({ availableM2: 30, requiredM2: 12, status: "compatible" });

    expect(text.title).toBe("Compatibilidad espacial: compatible");
    expect(text.detail).toContain("12 m² requeridos de 30 m² disponibles");
  });

  it("advierte cuando se excede el área", () => {
    const text = spatialDiagnosticText({ availableM2: 10, requiredM2: 16, status: "exceeded" });

    expect(text.title).toBe("Compatibilidad espacial excedida");
    expect(text.tone).toBe("warning");
  });
});
