import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DomainEvent } from "@/modules/events/domain/event-contracts";

import { BudgetBar } from "./budget-bar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const visible = (text: string | null) => (text ?? "").replace(/\s/g, " ");

function event(type: DomainEvent["type"], payload: Record<string, unknown>, eventId: string): DomainEvent {
  return {
    eventId,
    occurredAt: "2026-11-25T12:00:00.000Z",
    packageId: "pkg-1",
    payload,
    schemaVersion: 1,
    type,
    userId: "user-1",
  } as DomainEvent;
}

describe("BudgetBar (rediseño visual móvil)", () => {
  it("muestra el total confirmado y las unidades del evento", () => {
    render(
      <BudgetBar
        budget={{ packageVersion: 3, status: "confirmed", totalCop: 685000 }}
        packageId="pkg-1"
        packageVersion={3}
        subscriber={vi.fn().mockResolvedValue(vi.fn())}
        unitCount={4}
      />,
    );

    const bar = screen.getByRole("complementary", { name: "Presupuesto del evento" });
    expect(visible(bar.textContent)).toContain("$ 685.000");
    expect(screen.getByRole("status")).toHaveTextContent("4 elementos en tu evento");
  });

  it("usa singular con un elemento y avisa cuando aún no hay total", () => {
    render(
      <BudgetBar
        budget={{ status: "pending" }}
        packageId="pkg-1"
        packageVersion={1}
        subscriber={vi.fn().mockResolvedValue(vi.fn())}
        unitCount={1}
      />,
    );

    expect(screen.getByText("Sin calcular")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 elemento en tu evento");
  });

  it("al agregar muestra «Actualizando…» y luego el total nuevo que confirma Presupuesto", () => {
    let emit: (event: DomainEvent) => void = () => {};
    const subscriber = vi.fn().mockImplementation((_packageId, onEvent) => {
      emit = onEvent;
      return Promise.resolve(vi.fn());
    });

    render(
      <BudgetBar
        budget={{ packageVersion: 1, status: "confirmed", totalCop: 350000 }}
        packageId="pkg-1"
        packageVersion={1}
        subscriber={subscriber}
        unitCount={1}
      />,
    );

    act(() => emit(event("package.module.added", { moduleId: "m-1", packageVersion: 2 }, "evt-added")));
    expect(screen.getByRole("status")).toHaveTextContent("Actualizando…");

    act(() =>
      emit(event("budget.recalculated", { budgetId: "pkg-1", causationEventId: "evt-added", totalCop: 720000 }, "evt-budget")),
    );

    expect(visible(screen.getByRole("complementary", { name: "Presupuesto del evento" }).textContent)).toContain("$ 720.000");
  });
});
