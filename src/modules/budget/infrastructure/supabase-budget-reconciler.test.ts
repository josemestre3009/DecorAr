import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseBudgetReconciler } from "./supabase-budget-reconciler";

vi.mock("server-only", () => ({}));

const clientWith = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

const INPUT = {
  packageId: "pkg-1",
  packageVersion: 3,
  totalCop: 450000,
};

describe("SupabaseBudgetReconciler", () => {
  it("calls reconcile_budget with the expected arguments and maps a corrected row", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          corrected: true,
          package_id: "pkg-1",
          package_version: 3,
          total_cop: 450000,
          updated_at: "2026-10-10T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await new SupabaseBudgetReconciler(clientWith(rpc)).reconcile(INPUT);

    expect(rpc).toHaveBeenCalledWith("reconcile_budget", {
      p_package_id: "pkg-1",
      p_package_version: 3,
      p_total_cop: 450000,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        budget: {
          currency: "COP",
          packageId: "pkg-1",
          packageVersion: 3,
          totalCop: 450000,
          updatedAt: "2026-10-10T00:00:00.000Z",
        },
        corrected: true,
      },
    });
  });

  it("maps corrected=false without treating it as an error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          corrected: false,
          package_id: "pkg-1",
          package_version: 3,
          total_cop: 450000,
          updated_at: "2026-10-10T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await new SupabaseBudgetReconciler(clientWith(rpc)).reconcile(INPUT);

    expect(result.ok && result.value.corrected).toBe(false);
  });

  it.each(["package.invalid_version", "budget.invalid_total"])(
    "maps the known code %s to a DomainError with the same code",
    async (code) => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: code } });

      const result = await new SupabaseBudgetReconciler(clientWith(rpc)).reconcile(INPUT);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe(code);
    },
  );

  it("maps an unknown or thrown failure to budget.persistence_error", async () => {
    const unknownError = vi.fn().mockResolvedValue({ data: null, error: { message: "connection lost" } });
    const thrown = vi.fn().mockRejectedValue(new Error("fetch failed"));

    const a = await new SupabaseBudgetReconciler(clientWith(unknownError)).reconcile(INPUT);
    const b = await new SupabaseBudgetReconciler(clientWith(thrown)).reconcile(INPUT);

    expect(!a.ok && a.error).toMatchObject({ code: "budget.persistence_error", message: "connection lost" });
    expect(!b.ok && b.error).toMatchObject({ code: "budget.persistence_error", message: "fetch failed" });
  });

  it("reports an error when the RPC returns no row", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    const result = await new SupabaseBudgetReconciler(clientWith(rpc)).reconcile(INPUT);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("budget.persistence_error");
  });
});
