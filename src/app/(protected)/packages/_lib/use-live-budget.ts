"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createClient,
  subscribeToPackageChannel,
  type PackageChannelStatus,
} from "@/infrastructure/supabase/browser";
import type { DomainEvent } from "@/modules/events/domain/event-contracts";

import { createHttpBudgetClient, type BudgetClient } from "./budget-client";
import type { ConfiguratorBudget } from "./configurator-view";

export type PackageSubscriber = (
  packageId: string,
  onEvent: (event: DomainEvent) => void,
  onStatus: (status: PackageChannelStatus) => void,
) => Promise<() => Promise<void>>;

let cachedBrowserClient: ReturnType<typeof createClient> | undefined;

function getBrowserClient() {
  if (typeof window === "undefined") {
    return createClient();
  }
  if (!cachedBrowserClient) {
    cachedBrowserClient = createClient();
  }
  return cachedBrowserClient;
}

const defaultSubscriber: PackageSubscriber = async (packageId, onEvent, onStatus) => {
  const client = getBrowserClient();
  return subscribeToPackageChannel(client, packageId, onEvent, onStatus);
};

export type UseLiveBudgetOptions = {
  readonly packageId: string;
  readonly initialBudget: ConfiguratorBudget;
  readonly packageVersion: number;
  readonly budgetClient?: BudgetClient;
  readonly subscriber?: PackageSubscriber;
};

export type LiveBudgetState = {
  readonly budget: ConfiguratorBudget;
  readonly isUpdating: boolean;
  readonly syncError: boolean;
  readonly retry: () => Promise<void>;
};

/**
 * Hook reactivo para el presupuesto en tiempo real y resincronización (DECOR-21).
 *
 * Escucha eventos en el canal privado `package:{packageId}` vía Broadcast (DECOR-30):
 * - `package.module.added` / `package.module.removed` marcan el estado como actualizando.
 * - `budget.recalculated` (DECOR-29 / DECOR-33) aplica el nuevo total confirmado.
 * - Ignora eventos duplicados (`eventId`) y versiones anteriores.
 * - Ante reconexión, online, `visibilitychange` o hueco de versión, consulta `GET /api/packages/{id}/budget`.
 * - Ante fallo de red o error de sincronización, conserva el último total confirmado.
 */
export function useLiveBudget({
  packageId,
  initialBudget,
  packageVersion,
  budgetClient = createHttpBudgetClient(),
  subscriber = defaultSubscriber,
}: UseLiveBudgetOptions): LiveBudgetState {
  const [budget, setBudget] = useState<ConfiguratorBudget>(initialBudget);
  const [isUpdating, setIsUpdating] = useState<boolean>(() => {
    return initialBudget.status === "confirmed" && initialBudget.packageVersion < packageVersion;
  });
  const [syncError, setSyncError] = useState<boolean>(false);

  const seenEventIds = useRef<Set<string>>(new Set());
  const packageVersionRef = useRef<number>(packageVersion);

  const hasDisconnected = useRef<boolean>(false);
  const isResyncingRef = useRef<boolean>(false);
  const lastSyncedPackageVersion = useRef<number>(
    initialBudget.status === "confirmed" ? initialBudget.packageVersion : 0,
  );

  useEffect(() => {
    packageVersionRef.current = packageVersion;
  }, [packageVersion]);

  // Sincronizar durante render si el presupuesto inicial del servidor cambia (React pattern para props derivadas)
  const [lastInitialKey, setLastInitialKey] = useState<string>(() =>
    initialBudget.status === "confirmed"
      ? `confirmed:${initialBudget.packageVersion}:${initialBudget.totalCop}`
      : initialBudget.status,
  );
  const currentInitialKey =
    initialBudget.status === "confirmed"
      ? `confirmed:${initialBudget.packageVersion}:${initialBudget.totalCop}`
      : initialBudget.status;

  if (currentInitialKey !== lastInitialKey) {
    setLastInitialKey(currentInitialKey);
    if (initialBudget.status === "confirmed") {
      if (!(budget.status === "confirmed" && budget.packageVersion >= initialBudget.packageVersion)) {
        setBudget(initialBudget);
      }
    } else if (budget.status !== "confirmed") {
      setBudget(initialBudget);
    }
  }

  const resync = useCallback(async () => {
    if (isResyncingRef.current) return;
    isResyncingRef.current = true;
    setIsUpdating(true);

    try {
      const result = await budgetClient.getBudget(packageId);
      setIsUpdating(false);

      if (result.ok) {
        const fresh = result.value;
        setBudget((prev) => {
          // Ignorar versión vieja si ya tenemos una versión mayor confirmada
          if (prev.status === "confirmed" && fresh.packageVersion < prev.packageVersion) {
            return prev;
          }
          return {
            packageVersion: fresh.packageVersion,
            status: "confirmed",
            totalCop: fresh.totalCop,
          };
        });
        setSyncError(false);
      } else {
        if (result.error.kind === "not_found" && result.error.code === "budget.not_found") {
          setBudget((prev) => (prev.status === "confirmed" ? prev : { status: "pending" }));
          setSyncError(false);
        } else {
          // En caso de fallo, se conserva el último presupuesto confirmado en memoria
          setSyncError(true);
        }
      }
    } finally {
      isResyncingRef.current = false;
    }
  }, [budgetClient, packageId]);

  const handleEvent = useCallback((event: DomainEvent) => {
    if (seenEventIds.current.has(event.eventId)) {
      return;
    }
    seenEventIds.current.add(event.eventId);

    if (event.type === "package.module.added" || event.type === "package.module.removed") {
      setIsUpdating(true);
      return;
    }

    if (event.type === "budget.recalculated") {
      setIsUpdating(false);
      setSyncError(false);
      setBudget((prev) => ({
        packageVersion: Math.max(
          prev.status === "confirmed" ? prev.packageVersion : 0,
          packageVersionRef.current,
        ),
        status: "confirmed",
        totalCop: event.payload.totalCop,
      }));
    }
  }, []);

  const handleStatus = useCallback(
    (status: PackageChannelStatus) => {
      if (status === "closed" || status === "denied") {
        hasDisconnected.current = true;
      } else if (status === "subscribed") {
        if (hasDisconnected.current) {
          hasDisconnected.current = false;
          void resync();
        }
      }
    },
    [resync],
  );

  // Suscripción al canal privado de Realtime
  useEffect(() => {
    let isMounted = true;
    let cleanup: (() => Promise<void>) | undefined;

    void subscriber(packageId, handleEvent, handleStatus)
      .then((unsubscribe) => {
        if (isMounted) {
          cleanup = unsubscribe;
        } else {
          void unsubscribe();
        }
      })
      .catch((error) => {
        console.error("[useLiveBudget] Error al suscribirse a Realtime:", error);
        if (isMounted) {
          setSyncError(true);
        }
      });

    return () => {
      isMounted = false;
      if (cleanup) {
        void cleanup();
      }
    };
  }, [packageId, subscriber, handleEvent, handleStatus]);

  // Resincronización ante eventos del navegador (online y visibilidad)
  useEffect(() => {
    const onOnline = () => {
      void resync();
    };

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void resync();
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [resync]);

  // Detección de hueco / versión retrasada
  useEffect(() => {
    if (
      budget.status === "confirmed" &&
      budget.packageVersion < packageVersion &&
      lastSyncedPackageVersion.current !== packageVersion
    ) {
      lastSyncedPackageVersion.current = packageVersion;
      void resync();
    }
  }, [budget, packageVersion, resync]);

  return {
    budget,
    isUpdating,
    retry: resync,
    syncError,
  };
}
