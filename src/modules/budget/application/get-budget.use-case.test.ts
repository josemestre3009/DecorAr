import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok } from "../../../shared/domain/result";
import type { BudgetState } from "../domain/budget-state";
import { GetBudgetUseCase, type BudgetReader } from "./get-budget.use-case";

const BUDGET: BudgetState = {
  packageId: "pkg-1",
  totalCop: 450000,
  currency: "COP",
  packageVersion: 3,
  updatedAt: "2026-10-08T00:00:00.000Z",
};

describe("GetBudgetUseCase", () => {
  it("devuelve el presupuesto confirmado del paquete", async () => {
    const reader: BudgetReader = { findByPackage: vi.fn(async () => ok(BUDGET)) };

    const result = await new GetBudgetUseCase(reader).execute("pkg-1");

    expect(reader.findByPackage).toHaveBeenCalledWith("pkg-1");
    expect(result).toEqual(ok(BUDGET));
  });

  it("responde budget.not_found cuando el paquete nunca tuvo un evento procesado", async () => {
    const reader: BudgetReader = { findByPackage: vi.fn(async () => ok(null)) };

    const result = await new GetBudgetUseCase(reader).execute("pkg-1");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("budget.not_found");
  });

  it("propaga un fallo de lectura", async () => {
    const failure = new DomainError("budget.persistence_error", "boom");
    const reader: BudgetReader = { findByPackage: vi.fn(async () => err(failure)) };

    const result = await new GetBudgetUseCase(reader).execute("pkg-1");

    expect(result).toEqual(err(failure));
  });
});
