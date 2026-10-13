"use client";

import type { BudgetClient } from "../_lib/budget-client";
import type { ConfiguratorBudget } from "../_lib/configurator-view";
import { formatCop } from "../_lib/format";
import { useLiveBudget, type PackageSubscriber } from "../_lib/use-live-budget";

import { RefreshButton } from "./refresh-button";

type BudgetTotalProps = {
  readonly packageId?: string;
  readonly budget: ConfiguratorBudget;
  /** Versión actual del paquete, para avisar si el total es de una versión anterior. */
  readonly packageVersion: number;
  readonly budgetClient?: BudgetClient;
  readonly subscriber?: PackageSubscriber;
};

/**
 * Total confirmado del paquete. Lo calcula y persiste Presupuesto (DECOR-33);
 * se actualiza reactivamente por Broadcast privado en tiempo real y resync API (DECOR-21).
 */
export function BudgetTotal({
  budget: initialBudget,
  packageVersion,
  packageId,
  budgetClient,
  subscriber,
}: BudgetTotalProps) {
  const live = useLiveBudget({
    budgetClient,
    initialBudget,
    packageId: packageId ?? "",
    packageVersion,
    subscriber,
  });

  const budget = packageId ? live.budget : initialBudget;
  const isUpdating = packageId
    ? live.isUpdating
    : initialBudget.status === "confirmed" && initialBudget.packageVersion < packageVersion;
  const syncError = packageId ? live.syncError : false;
  const retry = live.retry;

  return (
    <section aria-labelledby="budget-total-title" className="configurator-card budget-total">
      <h2 className="section-title" id="budget-total-title">
        Presupuesto
      </h2>

      {budget.status === "confirmed" ? (
        <>
          <p aria-live="polite" className="budget-amount" role="status">
            <span className="budget-label">Total confirmado</span>
            <strong>{formatCop(budget.totalCop)}</strong>
          </p>

          {isUpdating ? (
            <div className="budget-note">
              <p aria-live="polite" role="status">
                Hay cambios más recientes en el evento; el total se está recalculando.
              </p>
              <RefreshButton label="Actualizar total" onAction={() => void retry()} />
            </div>
          ) : (
            <p className="budget-note">
              Calculado por Presupuesto para la versión {budget.packageVersion} del evento.
            </p>
          )}

          {syncError ? (
            <div className="budget-note" role="alert">
              <p className="auth-error">No pudimos sincronizar el presupuesto más reciente.</p>
              <RefreshButton label="Reintentar" onAction={() => void retry()} />
            </div>
          ) : null}
        </>
      ) : null}

      {budget.status === "pending" ? (
        <>
          <p aria-live="polite" className="budget-note" role="status">
            Presupuesto aún no calculado. Se calcula cuando agregas o quitas elementos.
          </p>
          {isUpdating ? (
            <p aria-live="polite" className="budget-note" role="status">
              Actualizando presupuesto…
            </p>
          ) : null}
          {syncError ? (
            <div className="budget-note" role="alert">
              <p className="auth-error">No pudimos sincronizar el presupuesto más reciente.</p>
              <RefreshButton label="Reintentar" onAction={() => void retry()} />
            </div>
          ) : null}
        </>
      ) : null}

      {budget.status === "error" ? (
        <div className="budget-note">
          <p className="auth-error" role="alert">
            No pudimos obtener el presupuesto.
          </p>
          <RefreshButton label="Reintentar" onAction={() => void retry()} />
        </div>
      ) : null}
    </section>
  );
}
