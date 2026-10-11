# Proposal

## Why

DECOR-32 deja el drenado inicial de `private.domain_events` con un único intento: si la publicación falla, el evento queda `pending` con `attempts = 1` y nadie lo vuelve a tocar. DECOR-33 deja `budgets` idempotente por `eventId`, pero si un evento nunca llega a publicarse, el presupuesto nunca se recalcula y no hay forma de corregirlo salvo leer PostgreSQL a mano. Tampoco existe un formato de log común: los fallos de hoy son `console.error` con texto libre, sin `correlationId` ni garantía de que no se filtre un secreto.

## What Changes

- Añadir una columna `correlation_id` y el estado `failed` a `private.domain_events` (migración aditiva), junto a las funciones `claim_retry_domain_event`, `list_retryable_domain_events`, `mark_domain_event_failed` y `reconcile_budget`.
- Añadir el puerto `Sleep` y el caso de uso `RetryOutboxUseCase`: toma eventos `pending` con 1 a 3 intentos, espera 1/2/4 s según el intento, reclama de forma segura ante concurrencia, publica y marca éxito o fallo; al cuarto fallo marca `failed` en vez de reintentar de nuevo.
- Añadir el caso de uso `ReconcileBudgetUseCase`: relee el paquete, recalcula con `calculateBudget` (DECOR-33) y corrige `budgets` solo si el total difiere, vía la función `reconcile_budget`.
- Añadir un logger JSON sanitizado (`src/shared/application/logger` ya define el puerto; se añade el adaptador y el sanitizador) que censura tokens, cookies, claves, contraseñas, emails completos y cualquier payload marcado como sensible.
- Añadir `POST/GET /api/internal/recovery`, protegido por un secreto Bearer (`DECOR_RECOVERY_SECRET`), para listar pendientes/fallidos, disparar los reintentos y disparar la reconciliación.
- Propagar `correlationId` desde la cabecera `x-correlation-id` (o generarlo) en `PackageController` hasta `commit_package_change` y los logs.

## Capabilities

### New Capabilities

- `async-recovery-observability`: logging sanitizado, reintentos acotados a tres intentos con backoff 1/2/4 s, reconciliación idempotente de presupuesto y endpoint protegido para operar la recuperación.

### Modified Capabilities

Ninguna. `event-outbox` (DECOR-32) e `idempotent-budget-consumer` (DECOR-33) no cambian su contrato: este cambio solo añade columnas y funciones nuevas a `private.domain_events`, además de una función nueva `reconcile_budget` que opera sobre `public.budgets` sin modificar `process_budget_event`.

## Impact

- Migración SQL aditiva y su prueba de contrato en PGlite.
- Código nuevo en `src/shared/application` (logger, sanitizador), `src/modules/events/application` (reintentos), `src/modules/budget/application` (reconciliación), `src/interfaces/recovery` y `src/app/api/internal/recovery`.
- Amplía `src/composition/server.ts` y `PackageController` sin romper lo existente.
- No crea UI de recuperación.
