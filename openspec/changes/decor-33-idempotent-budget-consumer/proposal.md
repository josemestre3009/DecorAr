# Proposal

## Why

DECOR-29 fijó el evento `budget.recalculated` y DECOR-32 dejó la outbox `private.domain_events` drenando `package.module.added`/`package.module.removed` hacia el Broadcast privado `package:{packageId}`. Nadie calcula ni persiste el presupuesto todavía: Presupuesto no existe como consumidor, por lo que un cambio de paquete nunca llega a un total confirmado ni puede resincronizarse tras una desconexión.

## What Changes

- Añadir `calculateBudget`, puro en `src/modules/budget/domain`: suma el `priceCop` vigente de cada hoja (`package_items`) existente en el paquete; un grupo no suma nada propio, solo agrega el de sus hojas.
- Añadir el puerto `PackageSnapshotReader` (lee ítems + `packageVersion` del paquete) y el caso de uso `ConsumePackageChangedEvent`: valida el evento recibido con `parseDomainEvent`, relee el paquete, calcula el total, pide a la RPC `process_budget_event` que lo persista de forma idempotente y publica `budget.recalculated` solo cuando la RPC aplicó un cambio real.
- Añadir la migración `private.processed_events` (UNIQUE `consumer, event_id`) y `public.budgets`, ambas deny-all para `anon`/`authenticated`, y la función `process_budget_event(p_consumer, p_event_id, p_package_id, p_package_version, p_total_cop)`: inserta el `processed_event` primero (un duplicado no toca `budgets`) y solo actualiza `budgets` cuando `p_package_version` es mayor que la versión ya guardada.
- Añadir el adaptador Supabase del puerto de presupuesto y exponer `createBudgetConsumerDependencies()` en la composición, con el cliente `service_role` igual que el drainer de DECOR-32.
- Añadir `GET /api/packages/{id}/budget`: reutiliza `checkPackageAccess` (DECOR-30) y responde `{totalCop, currency:'COP', packageVersion, updatedAt}` o 401/404/500 con el envelope `{error:{code,message}}`.
- Conectar el consumo al drenado existente: `DrainOutboxUseCase` ya publica por Broadcast; este cambio añade el consumo del lado de Presupuesto a partir del mismo evento, sin modificar la outbox de DECOR-32.

## Capabilities

### New Capabilities

- `idempotent-budget-consumer`: cálculo de presupuesto por Composite, persistencia atómica e idempotente por `eventId`, resync vía GET, publicación de `budget.recalculated` propiedad exclusiva de Presupuesto.

### Modified Capabilities

Ninguna. `event-outbox` y `authorization-rls-private-channels` no cambian: este consumidor solo lee el contrato ya fijado.

## Impact

- Añade una migración SQL y su prueba de contrato (sigue el patrón PGlite de DECOR-30 cuando aplica, y el patrón de aserciones de texto de DECOR-32 para la función).
- Añade código en `src/modules/budget/domain`, `src/modules/budget/application` e `infrastructure`, con pruebas unitarias.
- Añade `src/app/api/packages/[packageId]/budget/route.ts`.
- Amplía `src/composition/server.ts` sin cambiar lo existente.
- No crea UI, no implementa reintentos (DECOR-31) ni toca `packages`/`catalog`.
