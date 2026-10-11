import type { ConfiguratorBudget } from "../_lib/configurator-view";
import { formatCop } from "../_lib/format";

import { RefreshButton } from "./refresh-button";

type BudgetTotalProps = {
  readonly budget: ConfiguratorBudget;
  /** Versión actual del paquete, para avisar si el total es de una versión anterior. */
  readonly packageVersion: number;
};

/**
 * Total confirmado del paquete. Lo calcula y persiste Presupuesto (DECOR-33);
 * aquí solo se muestra. Las actualizaciones en tiempo real son de DECOR-21.
 */
export function BudgetTotal({ budget, packageVersion }: BudgetTotalProps) {
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
          {budget.packageVersion < packageVersion ? (
            <div className="budget-note">
              <p>Hay cambios más recientes en el paquete; el total se está recalculando.</p>
              <RefreshButton label="Actualizar total" />
            </div>
          ) : (
            <p className="budget-note">Calculado por Presupuesto para la versión {budget.packageVersion} del paquete.</p>
          )}
        </>
      ) : null}

      {budget.status === "pending" ? (
        <p aria-live="polite" className="budget-note" role="status">
          Presupuesto aún no calculado. Se calcula cuando agregas o quitas elementos.
        </p>
      ) : null}

      {budget.status === "error" ? (
        <div className="budget-note">
          <p className="auth-error" role="alert">
            No pudimos obtener el presupuesto.
          </p>
          <RefreshButton label="Reintentar" />
        </div>
      ) : null}
    </section>
  );
}
