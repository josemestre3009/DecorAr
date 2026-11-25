"use client";

import type { BudgetClient } from "../_lib/budget-client";
import type { ConfiguratorBudget } from "../_lib/configurator-view";
import { formatCop } from "../_lib/format";
import { useLiveBudget, type PackageSubscriber } from "../_lib/use-live-budget";

type BudgetBarProps = {
  readonly packageId: string;
  readonly budget: ConfiguratorBudget;
  readonly packageVersion: number;
  /** Unidades del evento confirmadas por el servidor. */
  readonly unitCount: number;
  /** Inyectables para las pruebas. */
  readonly budgetClient?: BudgetClient;
  readonly subscriber?: PackageSubscriber;
};

/**
 * Presupuesto a la vista mientras se arma el evento en el catálogo (rediseño
 * visual móvil). Usa el mismo presupuesto en vivo que la sección Evento
 * (DECOR-21/33): al agregar, muestra "Actualizando…" y luego el total nuevo
 * que confirma Presupuesto, con una pequeña animación del monto.
 */
export function BudgetBar({ packageId, budget: initialBudget, packageVersion, unitCount, budgetClient, subscriber }: BudgetBarProps) {
  const { budget, isUpdating } = useLiveBudget({
    budgetClient,
    initialBudget,
    packageId,
    packageVersion,
    subscriber,
  });

  const amount = budget.status === "confirmed" ? formatCop(budget.totalCop) : null;
  const detail = isUpdating
    ? "Actualizando…"
    : `${unitCount} ${unitCount === 1 ? "elemento" : "elementos"} en tu evento`;

  return (
    <aside aria-label="Presupuesto del evento" className="budget-bar">
      <div className="budget-bar-text">
        <p className="budget-bar-label">Presupuesto</p>
        <p aria-live="polite" className="budget-bar-detail" role="status">
          {detail}
        </p>
      </div>
      <p className={isUpdating ? "budget-bar-amount budget-bar-updating" : "budget-bar-amount"} key={amount ?? budget.status}>
        {amount ?? (budget.status === "pending" ? "Sin calcular" : "No disponible")}
      </p>
    </aside>
  );
}
