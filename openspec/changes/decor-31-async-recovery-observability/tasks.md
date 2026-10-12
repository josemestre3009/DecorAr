# Tasks

## 1. Persistencia

- [x] 1.1 Migración aditiva: `correlation_id` y estado `failed` en `private.domain_events`, `claim_retry_domain_event`, `list_retryable_domain_events`, `mark_domain_event_failed`, `list_unresolved_domain_events` y `reconcile_budget`; verificar con prueba de contrato en PGlite
- [x] 1.2 Verificar en PGlite el reclamo seguro de reintentos ante concurrencia, la transición a `failed`, la reconciliación idempotente y los permisos de `anon`/`authenticated`

## 2. Logging sanitizado

- [x] 2.1 Añadir `sanitizeLogContext` (censura tokens, cookies, claves, contraseñas, payload; enmascara email y JWT/Bearer) en `src/shared/application`; verificar con pruebas unitarias
- [x] 2.2 Añadir el adaptador `createJsonLogger` sobre el puerto `Logger` ya existente, en `src/infrastructure/logging`; verificar con pruebas unitarias

## 3. Reintentos

- [x] 3.1 Añadir el puerto `Sleep` en `src/shared/application/ports.ts` y extender `OutboxStore` (`listRetryable`, `claimRetry`, `markFailed`, `listUnresolved`) en `src/modules/events/application/outbox.ts`
- [x] 3.2 Añadir `RetryOutboxUseCase`: backoff 1/2/4s inyectado, reclamo seguro, marca `failed` tras el tercer reintento; verificar con pruebas unitarias (recuperación, agotamiento exacto de tres reintentos, concurrencia, correlationId en logs)
- [x] 3.3 Implementar los nuevos métodos en `SupabaseEventOutbox`; verificar con pruebas unitarias

## 4. Reconciliación

- [x] 4.1 Añadir el puerto `BudgetReconciler` y `ReconcileBudgetUseCase` (relee, recalcula con `calculateBudget`, corrige) en `src/modules/budget/application`; verificar con pruebas unitarias
- [x] 4.2 Implementar `SupabaseBudgetReconciler` sobre `reconcile_budget`; verificar con pruebas unitarias

## 5. Endpoint y composición

- [x] 5.1 Añadir `getRecoverySecret()` en `src/lib/env.ts` y `DECOR_RECOVERY_SECRET` en `.env.example`
- [x] 5.2 Añadir `RecoveryController` (secreto Bearer con comparación constante, 503 sin configurar, 401 si no coincide) en `src/interfaces/recovery`; verificar con pruebas unitarias
- [x] 5.3 Añadir `GET/POST /api/internal/recovery` y `createRecoveryController()` en la composición; verificar con prueba de composición

## 6. correlationId

- [x] 6.1 Añadir `correlationId` opcional a `PackageChangeOutbox.commit`, `AddModuleToPackageDto` y `RemoveModuleFromPackageDto`; propagar desde `PackageController` (lee o genera `x-correlation-id`, lo devuelve en la respuesta); verificar con pruebas unitarias
- [x] 6.2 Pasar `p_correlation_id` en `SupabaseEventOutbox.commit`; verificar con pruebas unitarias

## 7. Integración

- [x] 7.1 Verificar que `scripts/scan-architecture.test.ts` sigue sin violaciones con los archivos nuevos
- [x] 7.2 Ejecutar `npm run lint`, `npm run typecheck` y las pruebas afectadas
- [x] 7.3 Ejecutar `openspec validate decor-31-async-recovery-observability --type change --strict` (CLI instalado: superado)
- [x] 7.4 Documentar la guía de fallo/recuperación en `docs/DecorAR.md` y actualizar los README de `events` y `budget`
