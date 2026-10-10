import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseBudgetConsumer } from "./supabase-budget-consumer";

vi.mock("server-only", () => ({}));

const clientWith = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

const INPUT = {
  consumer: "budget",
  eventId: "evt-1",
  packageId: "pkg-1",
  packageVersion: 3,
  totalCop: 450000,
};

describe("SupabaseBudgetConsumer", () => {
  it("invoca process_budget_event con los argumentos esperados y mapea la fila aplicada", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { applied: true, package_id: "pkg-1", total_cop: 450000, package_version: 3, updated_at: "2026-10-08T00:00:00.000Z" },
      ],
      error: null,
    });

    const result = await new SupabaseBudgetConsumer(clientWith(rpc)).process(INPUT);

    expect(rpc).toHaveBeenCalledWith("process_budget_event", {
      p_consumer: "budget",
      p_event_id: "evt-1",
      p_package_id: "pkg-1",
      p_package_version: 3,
      p_total_cop: 450000,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        applied: true,
        budget: {
          packageId: "pkg-1",
          totalCop: 450000,
          currency: "COP",
          packageVersion: 3,
          updatedAt: "2026-10-08T00:00:00.000Z",
        },
      },
    });
  });

  it("mapea applied=false sin tratarlo como error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { applied: false, package_id: "pkg-1", total_cop: 450000, package_version: 3, updated_at: "2026-10-08T00:00:00.000Z" },
      ],
      error: null,
    });

    const result = await new SupabaseBudgetConsumer(clientWith(rpc)).process(INPUT);

    expect(result.ok && result.value.applied).toBe(false);
  });

  it.each(["budget.invalid_consumer", "budget.invalid_total", "event.invalid", "package.invalid_version"])(
    "mapea el código conocido %s a un DomainError con el mismo code",
    async (code) => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: code } });

      const result = await new SupabaseBudgetConsumer(clientWith(rpc)).process(INPUT);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe(code);
    },
  );

  it("mapea un error desconocido o lanzado a budget.persistence_error", async () => {
    const unknownError = vi.fn().mockResolvedValue({ data: null, error: { message: "connection lost" } });
    const thrown = vi.fn().mockRejectedValue(new Error("fetch failed"));

    const a = await new SupabaseBudgetConsumer(clientWith(unknownError)).process(INPUT);
    const b = await new SupabaseBudgetConsumer(clientWith(thrown)).process(INPUT);

    expect(!a.ok && a.error).toMatchObject({ code: "budget.persistence_error", message: "connection lost" });
    expect(!b.ok && b.error).toMatchObject({ code: "budget.persistence_error", message: "fetch failed" });
  });

  it("reporta un error cuando la RPC no devuelve ninguna fila", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    const result = await new SupabaseBudgetConsumer(clientWith(rpc)).process(INPUT);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("budget.persistence_error");
  });
});
