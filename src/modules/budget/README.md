# Budget

- `domain`: `calculateBudget` (Composite puro: suma `priceCop` de cada hoja, un grupo no aporta monto propio) y `BudgetState`.
- `application`: `ConsumePackageChangedEvent` (releer paquete, calcular, persistir idempotentemente, publicar sólo si aplicó), `GetBudgetUseCase` (resync) y `ReconcileBudgetUseCase` (DECOR-31: relee, recalcula y corrige), mediante puertos (`PackageSnapshotReader`, `BudgetConsumer`, `BudgetReader`, `BudgetReconciler`).
- `infrastructure`: adaptadores Supabase server-only para los cuatro puertos, sobre `public.budgets`, `private.processed_events` y las RPC `process_budget_event` (DECOR-33) y `reconcile_budget` (DECOR-31).

El módulo consume contratos de eventos sin ser invocado directamente por `packages`: quien comitea un cambio de paquete (DECOR-27) llama a `ConsumePackageChangedEvent.execute(event)` con el mismo evento ya persistido, en lugar de que Presupuesto se suscriba al Broadcast. Idempotencia por `eventId` y no-regresión por `packageVersion` (no por `occurredAt`) se deciden en `process_budget_event`, no en TypeScript.

`ReconcileBudgetUseCase` (DECOR-31) es independiente de cualquier evento concreto: relee el paquete persistido, recalcula con el mismo `calculateBudget` y corrige `public.budgets` vía `reconcile_budget` si el total almacenado difiere, incluso para la misma `packageVersion` (a diferencia de `process_budget_event`, que sólo avanza con una versión estrictamente mayor). Se invoca desde el endpoint de recuperación (`src/interfaces/recovery`) para los paquetes cuyo evento quedó `failed` tras agotar sus reintentos.
