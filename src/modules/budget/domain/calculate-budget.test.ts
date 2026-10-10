import { describe, expect, it } from "vitest";

import { calculateBudget, type BudgetNode } from "./calculate-budget";

const leaf = (priceCop: number): BudgetNode => ({ kind: "leaf", priceCop });
const group = (children: readonly BudgetNode[]): BudgetNode => ({ kind: "group", children });

describe("calculateBudget", () => {
  it("suma el priceCop de hojas simples sin grupos", () => {
    const result = calculateBudget({
      packageId: "pkg-1",
      packageVersion: 1,
      nodes: [leaf(250000), leaf(200000), leaf(600000)],
    });

    expect(result).toEqual({ ok: true, value: 1050000 });
  });

  it("un grupo no aporta un monto propio, solo el de sus hojas", () => {
    const result = calculateBudget({
      packageId: "pkg-1",
      packageVersion: 1,
      nodes: [group([leaf(200000), leaf(250000)])],
    });

    expect(result).toEqual({ ok: true, value: 450000 });
  });

  it("suma recursivamente grupos anidados hasta tres niveles", () => {
    const result = calculateBudget({
      packageId: "pkg-1",
      packageVersion: 1,
      nodes: [group([leaf(100000), group([leaf(50000), group([leaf(25000)])])])],
    });

    expect(result).toEqual({ ok: true, value: 175000 });
  });

  it("un paquete sin hojas suma cero", () => {
    const result = calculateBudget({ packageId: "pkg-1", packageVersion: 1, nodes: [] });

    expect(result).toEqual({ ok: true, value: 0 });
  });

  it("un grupo vacío no aporta nada", () => {
    const result = calculateBudget({
      packageId: "pkg-1",
      packageVersion: 1,
      nodes: [leaf(100000), group([])],
    });

    expect(result).toEqual({ ok: true, value: 100000 });
  });

  it("rechaza una hoja con precio negativo", () => {
    const result = calculateBudget({ packageId: "pkg-1", packageVersion: 1, nodes: [leaf(-1)] });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("budget.invalid_leaf_price");
  });

  it("rechaza una hoja con precio no entero", () => {
    const result = calculateBudget({
      packageId: "pkg-1",
      packageVersion: 1,
      nodes: [leaf(100.5)],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("budget.invalid_leaf_price");
  });

  it("rechaza una hoja inválida anidada dentro de un grupo", () => {
    const result = calculateBudget({
      packageId: "pkg-1",
      packageVersion: 1,
      nodes: [group([leaf(100000), group([leaf(-5)])])],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("budget.invalid_leaf_price");
  });
});
