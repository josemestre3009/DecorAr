import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, err } from "@/shared/domain/result";
import type { DomainEvent, BudgetRecalculatedEvent, PackageModuleAddedEvent } from "@/modules/events/domain/event-contracts";
import type { PackageChannelStatus } from "@/infrastructure/supabase/browser";

import type { BudgetClient, ConfirmedBudget } from "./budget-client";
import { useLiveBudget, type PackageSubscriber } from "./use-live-budget";

describe("useLiveBudget (DECOR-21)", () => {
  let mockEventCallback: (event: DomainEvent) => void;
  let mockStatusCallback: (status: PackageChannelStatus) => void;
  let mockUnsubscribe: ReturnType<typeof vi.fn>;
  let mockSubscriber: PackageSubscriber;
  let mockBudgetClient: BudgetClient;

  beforeEach(() => {
    mockUnsubscribe = vi.fn().mockResolvedValue(undefined);
    mockSubscriber = vi.fn().mockImplementation((_pkgId, onEvent, onStatus) => {
      mockEventCallback = onEvent;
      mockStatusCallback = onStatus;
      return Promise.resolve(mockUnsubscribe);
    });

    mockBudgetClient = {
      getBudget: vi.fn().mockResolvedValue(
        ok<ConfirmedBudget>({
          currency: "COP",
          packageVersion: 2,
          totalCop: 800000,
          updatedAt: "2026-10-11T12:00:00.000Z",
        }),
      ),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inicializa con el presupuesto del servidor sin llamar a resync innecesariamente si las versiones coinciden", () => {
    const { result } = renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 2, status: "confirmed", totalCop: 500000 },
        packageId: "pkg-1",
        packageVersion: 2,
        subscriber: mockSubscriber,
      }),
    );

    expect(result.current.budget).toEqual({
      packageVersion: 2,
      status: "confirmed",
      totalCop: 500000,
    });
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.syncError).toBe(false);
    expect(mockSubscriber).toHaveBeenCalledWith("pkg-1", expect.any(Function), expect.any(Function));
    expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();
  });

  it("activa isUpdating cuando llega un evento package.module.added", async () => {
    const { result } = renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 1, status: "confirmed", totalCop: 300000 },
        packageId: "pkg-1",
        packageVersion: 1,
        subscriber: mockSubscriber,
      }),
    );

    const addedEvent: PackageModuleAddedEvent = {
      eventId: "evt-add-1",
      occurredAt: "2026-10-11T12:00:00.000Z",
      packageId: "pkg-1",
      payload: { itemId: "item-1", moduleId: "mod-1" },
      schemaVersion: 1,
      type: "package.module.added",
      userId: "user-1",
    };

    act(() => {
      mockEventCallback(addedEvent);
    });

    expect(result.current.isUpdating).toBe(true);
  });

  it("aplica budget.recalculated actualizando el total y desactivando isUpdating", async () => {
    const { result } = renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 1, status: "confirmed", totalCop: 300000 },
        packageId: "pkg-1",
        packageVersion: 2,
        subscriber: mockSubscriber,
      }),
    );

    const recalcEvent: BudgetRecalculatedEvent = {
      eventId: "evt-recalc-1",
      occurredAt: "2026-10-11T12:01:00.000Z",
      packageId: "pkg-1",
      payload: { budgetId: "pkg-1", causationEventId: "evt-add-1", totalCop: 750000 },
      schemaVersion: 1,
      type: "budget.recalculated",
      userId: "user-1",
    };

    act(() => {
      mockEventCallback(recalcEvent);
    });

    expect(result.current.budget).toEqual({
      packageVersion: 2,
      status: "confirmed",
      totalCop: 750000,
    });
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.syncError).toBe(false);
  });

  it("ignora un evento duplicado con el mismo eventId", async () => {
    const { result } = renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 1, status: "confirmed", totalCop: 300000 },
        packageId: "pkg-1",
        packageVersion: 1,
        subscriber: mockSubscriber,
      }),
    );

    const recalcEvent: BudgetRecalculatedEvent = {
      eventId: "evt-dup-1",
      occurredAt: "2026-10-11T12:01:00.000Z",
      packageId: "pkg-1",
      payload: { budgetId: "pkg-1", causationEventId: "evt-add-1", totalCop: 400000 },
      schemaVersion: 1,
      type: "budget.recalculated",
      userId: "user-1",
    };

    act(() => {
      mockEventCallback(recalcEvent);
    });
    expect(result.current.budget.status === "confirmed" && result.current.budget.totalCop).toBe(400000);

    // Segundo envío con el mismo eventId pero payload diferente simula duplicado desfasado
    act(() => {
      mockEventCallback({
        ...recalcEvent,
        payload: { ...recalcEvent.payload, totalCop: 999999 },
      });
    });

    // El valor se mantiene en 400000 porque el eventId ya fue procesado
    expect(result.current.budget.status === "confirmed" && result.current.budget.totalCop).toBe(400000);
  });

  it("detecta hueco de versión y dispara resincronización automática con GET /api/packages/{id}/budget", async () => {
    renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        // Presupuesto en versión 1, pero paquete en versión 3 (hueco)
        initialBudget: { packageVersion: 1, status: "confirmed", totalCop: 300000 },
        packageId: "pkg-1",
        packageVersion: 3,
        subscriber: mockSubscriber,
      }),
    );

    expect(mockBudgetClient.getBudget).toHaveBeenCalledWith("pkg-1");
  });

  it("ignora respuesta de resync si trae una versión inferior a la confirmada en cliente", async () => {
    // Cliente ya tiene versión 4 confirmada
    const { result } = renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 4, status: "confirmed", totalCop: 950000 },
        packageId: "pkg-1",
        packageVersion: 4,
        subscriber: mockSubscriber,
      }),
    );

    // Endpoint devuelve versión 2 desactualizada
    mockBudgetClient.getBudget = vi.fn().mockResolvedValue(
      ok<ConfirmedBudget>({
        currency: "COP",
        packageVersion: 2,
        totalCop: 400000,
        updatedAt: "2026-10-11T11:00:00.000Z",
      }),
    );

    await act(async () => {
      await result.current.retry();
    });

    // No debe sobrescribir la versión 4
    expect(result.current.budget).toEqual({
      packageVersion: 4,
      status: "confirmed",
      totalCop: 950000,
    });
  });

  it("resincroniza ante reconexión del canal Realtime tras una desconexión", async () => {
    renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 2, status: "confirmed", totalCop: 500000 },
        packageId: "pkg-1",
        packageVersion: 2,
        subscriber: mockSubscriber,
      }),
    );

    expect(mockBudgetClient.getBudget).not.toHaveBeenCalled();

    // Se desconecta
    act(() => {
      mockStatusCallback("closed");
    });

    // Se reconecta
    act(() => {
      mockStatusCallback("subscribed");
    });

    expect(mockBudgetClient.getBudget).toHaveBeenCalledWith("pkg-1");
  });

  it("resincroniza cuando el navegador vuelve a estar online", async () => {
    renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 2, status: "confirmed", totalCop: 500000 },
        packageId: "pkg-1",
        packageVersion: 2,
        subscriber: mockSubscriber,
      }),
    );

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(mockBudgetClient.getBudget).toHaveBeenCalledWith("pkg-1");
  });

  it("resincroniza cuando la pestaña vuelve a ser visible (visibilitychange)", async () => {
    renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 2, status: "confirmed", totalCop: 500000 },
        packageId: "pkg-1",
        packageVersion: 2,
        subscriber: mockSubscriber,
      }),
    );

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockBudgetClient.getBudget).toHaveBeenCalledWith("pkg-1");
  });

  it("conserva el último total confirmado si la resincronización falla y marca syncError", async () => {
    mockBudgetClient.getBudget = vi.fn().mockResolvedValue(
      err({ kind: "server", message: "Error interno" }),
    );

    const { result } = renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 2, status: "confirmed", totalCop: 500000 },
        packageId: "pkg-1",
        packageVersion: 2,
        subscriber: mockSubscriber,
      }),
    );

    await act(async () => {
      await result.current.retry();
    });

    // El último confirmado permanece intacto
    expect(result.current.budget).toEqual({
      packageVersion: 2,
      status: "confirmed",
      totalCop: 500000,
    });
    expect(result.current.syncError).toBe(true);
  });

  it("reintenta con retry() y limpia syncError si el reintento es exitoso", async () => {
    mockBudgetClient.getBudget = vi
      .fn()
      .mockResolvedValueOnce(err({ kind: "network", message: "Sin conexión" }))
      .mockResolvedValueOnce(
        ok<ConfirmedBudget>({
          currency: "COP",
          packageVersion: 3,
          totalCop: 650000,
          updatedAt: "2026-10-11T12:05:00.000Z",
        }),
      );

    const { result } = renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 2, status: "confirmed", totalCop: 500000 },
        packageId: "pkg-1",
        packageVersion: 2,
        subscriber: mockSubscriber,
      }),
    );

    // Primer intento falla
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.syncError).toBe(true);

    // Reintento exitoso
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.syncError).toBe(false);
    expect(result.current.budget).toEqual({
      packageVersion: 3,
      status: "confirmed",
      totalCop: 650000,
    });
  });

  it("ejecuta cleanup (unsubscribe) al desmontarse", async () => {
    const { unmount } = renderHook(() =>
      useLiveBudget({
        budgetClient: mockBudgetClient,
        initialBudget: { packageVersion: 1, status: "confirmed", totalCop: 200000 },
        packageId: "pkg-1",
        packageVersion: 1,
        subscriber: mockSubscriber,
      }),
    );

    await act(async () => {
      unmount();
    });

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
