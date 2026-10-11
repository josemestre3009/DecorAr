import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, err } from "@/shared/domain/result";
import type { DomainEvent } from "@/modules/events/domain/event-contracts";

import { BudgetTotal } from "./budget-total";
import { SpaceSummary } from "./space-summary";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const visible = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("BudgetTotal (DECOR-22)", () => {
  beforeEach(() => refresh.mockReset());

  it("muestra el total confirmado por Presupuesto y su versión", () => {
    render(
      <BudgetTotal
        budget={{ packageVersion: 3, status: "confirmed", totalCop: 1050000 }}
        packageVersion={3}
      />,
    );

    expect(visible(screen.getByRole("status").textContent)).toBe("Total confirmado$ 1.050.000");
    expect(screen.getByText(/versión 3 del paquete/)).toBeInTheDocument();
  });

  it("avisa cuando el total es de una versión anterior y permite actualizar", () => {
    render(
      <BudgetTotal
        budget={{ packageVersion: 2, status: "confirmed", totalCop: 450000 }}
        packageVersion={3}
      />,
    );

    expect(screen.getByText(/se está recalculando/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar total" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("sin presupuesto calculado (404) lo dice sin sumar en el cliente", () => {
    render(<BudgetTotal budget={{ status: "pending" }} packageVersion={1} />);

    expect(screen.getByRole("status")).toHaveTextContent("Presupuesto aún no calculado");
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("si falla la lectura muestra el error y permite reintentar", () => {
    render(<BudgetTotal budget={{ status: "error" }} packageVersion={1} />);

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos obtener el presupuesto.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("BudgetTotal en tiempo real (DECOR-21)", () => {
  beforeEach(() => refresh.mockReset());

  it("actualiza el total en pantalla al recibir budget.recalculated por Broadcast", () => {
    let emitEvent: (event: DomainEvent) => void = () => {};
    const mockSubscriber = vi.fn().mockImplementation((_pkgId, onEvent) => {
      emitEvent = onEvent;
      return Promise.resolve(vi.fn());
    });

    render(
      <BudgetTotal
        budget={{ packageVersion: 1, status: "confirmed", totalCop: 350000 }}
        packageId="pkg-live-1"
        packageVersion={1}
        subscriber={mockSubscriber}
      />,
    );

    expect(screen.getByText("$ 350.000")).toBeInTheDocument();

    act(() => {
      emitEvent({
        eventId: "recalc-evt-1",
        occurredAt: "2026-10-11T12:00:00.000Z",
        packageId: "pkg-live-1",
        payload: {
          budgetId: "pkg-live-1",
          causationEventId: "cause-1",
          totalCop: 720000,
        },
        schemaVersion: 1,
        type: "budget.recalculated",
        userId: "user-1",
      });
    });

    expect(screen.getByText("$ 720.000")).toBeInTheDocument();
  });

  it("conserva el último total confirmado si la sincronización falla y muestra alerta accesible", async () => {
    const mockBudgetClient = {
      getBudget: vi.fn().mockResolvedValue(err({ kind: "server", message: "Error" })),
    };
    const mockSubscriber = vi.fn().mockResolvedValue(vi.fn());

    render(
      <BudgetTotal
        budget={{ packageVersion: 2, status: "confirmed", totalCop: 500000 }}
        budgetClient={mockBudgetClient}
        packageId="pkg-live-1"
        packageVersion={3} // Provoca hueco y resync que falla
        subscriber={mockSubscriber}
      />,
    );

    // El último confirmado permanece en pantalla
    expect(screen.getByText("$ 500.000")).toBeInTheDocument();
    // Y se muestra el aviso de error de sincronización
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos sincronizar el presupuesto más reciente.");
  });

  it("permite reintentar la sincronización tras un fallo", async () => {
    const mockBudgetClient = {
      getBudget: vi
        .fn()
        .mockResolvedValueOnce(err({ kind: "server", message: "Error" }))
        .mockResolvedValueOnce(
          ok({
            currency: "COP" as const,
            packageVersion: 3,
            totalCop: 890000,
            updatedAt: "2026-10-11T12:00:00.000Z",
          }),
        ),
    };
    const mockSubscriber = vi.fn().mockResolvedValue(vi.fn());

    render(
      <BudgetTotal
        budget={{ packageVersion: 2, status: "confirmed", totalCop: 500000 }}
        budgetClient={mockBudgetClient}
        packageId="pkg-live-1"
        packageVersion={3}
        subscriber={mockSubscriber}
      />,
    );

    const retryBtn = await screen.findByRole("button", { name: "Reintentar" });
    fireEvent.click(retryBtn);

    expect(await screen.findByText("$ 890.000")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SpaceSummary (DECOR-22)", () => {
  it("muestra tipo descriptivo, capacidad, área usada y restante del servidor", () => {
    render(<SpaceSummary detail={{ capacityM2: 30, remainingM2: 14, spaceType: "aireLibre", usedM2: 16 }} />);

    const values = screen.getAllByRole("definition").map((dd) => visible(dd.textContent));
    expect(values).toEqual(["Aire libre (parque o playa)", "30 m²", "16 m²", "14 m²"]);
  });
});
