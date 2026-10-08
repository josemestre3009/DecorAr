# Tasks

## 1. Dominio

- [x] 1.1 Añadir `calculateBudget` (suma de hojas, grupos sin monto propio, paquete vacío = 0) en `src/modules/budget/domain`; verificar con pruebas unitarias

## 2. Aplicación

- [x] 2.1 Añadir el puerto `PackageSnapshotReader` y el tipo `BudgetState` en `src/modules/budget/application`
- [x] 2.2 Añadir el puerto `BudgetConsumer` (persistencia idempotente vía `process_budget_event`) y el caso de uso `ConsumePackageChangedEvent`: valida con `parseDomainEvent`, relee el paquete, calcula, persiste y publica `budget.recalculated` solo si `applied`; verificar con pruebas unitarias (duplicado, versión vieja, fallo de persistencia, publicación condicionada)
- [x] 2.3 Añadir el caso de uso `GetBudget` para el resync; verificar con pruebas unitarias (encontrado, no encontrado)

## 3. Persistencia

- [x] 3.1 Crear la migración con `public.budgets`, `private.processed_events` (`UNIQUE (consumer, event_id)`), grants deny-all para `anon`/`authenticated`, RLS de lectura del dueño en `budgets`, y `process_budget_event` (`SECURITY INVOKER`, `search_path=''`); verificar con prueba de contrato SQL siguiendo `create-event-outbox.test.ts`
- [x] 3.2 Verificar en PGlite que un `eventId` repetido no cambia `budgets`, que una `packageVersion` menor o igual no sobrescribe, y que `anon`/`authenticated` no leen/escriben `processed_events` ni escriben `budgets`

## 4. Infraestructura y composición

- [x] 4.1 Implementar el adaptador Supabase de `PackageSnapshotReader` (lee `package_items` + `packages.version`) en `src/modules/budget/infrastructure`; verificar con pruebas unitarias
- [x] 4.2 Implementar el adaptador Supabase de `BudgetConsumer` sobre `process_budget_event` y de lectura de `budgets` para `GetBudget`; verificar con pruebas unitarias
- [x] 4.3 Exponer `createBudgetConsumerDependencies()` (cliente `service_role`) y `createBudgetQueryDependencies()` (cliente de sesión) en `src/composition/server.ts`; verificar con prueba de composición
- [x] 4.4 Verificar que `budget` no es importado por `packages` y que sus adaptadores Supabase son server-only

## 5. HTTP

- [x] 5.1 Añadir `GET /api/packages/[packageId]/budget` usando `checkPackageAccess`; responde `{totalCop, currency:'COP', packageVersion, updatedAt}` o 401/404/500 con `{error:{code,message}}`; verificar con pruebas unitarias

## 6. Integración

- [x] 6.1 Documentar el consumidor y la convención `processed_events`/`budgets` en `docs/DecorAR.md` y el README de `budget`
- [x] 6.2 Ejecutar `npm run lint`, `npm run typecheck` y las pruebas afectadas
- [ ] 6.3 Ejecutar `openspec validate decor-33-idempotent-budget-consumer --type change --strict` (CLI no instalado en el entorno de implementación, igual que DECOR-30 y DECOR-32)
