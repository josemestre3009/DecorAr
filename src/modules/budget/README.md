# Budget

- `domain`: `calculateBudget` (Composite puro: suma `priceCop` de cada hoja, un grupo no aporta monto propio) y `BudgetState`.
- `application`: `ConsumePackageChangedEvent` (releer paquete, calcular, persistir idempotentemente, publicar sólo si aplicó) y `GetBudgetUseCase` (resync), ambos mediante puertos (`PackageSnapshotReader`, `BudgetConsumer`, `BudgetReader`).
- `infrastructure`: adaptadores Supabase server-only para los tres puertos, sobre `public.budgets`, `private.processed_events` y la RPC `process_budget_event` (DECOR-33).

El módulo consume contratos de eventos sin ser invocado directamente por `packages`: quien comitea un cambio de paquete (DECOR-27) llama a `ConsumePackageChangedEvent.execute(event)` con el mismo evento ya persistido, en lugar de que Presupuesto se suscriba al Broadcast. Idempotencia por `eventId` y no-regresión por `packageVersion` (no por `occurredAt`) se deciden en `process_budget_event`, no en TypeScript.
