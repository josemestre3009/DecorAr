# Proposal

## Why

DECOR-29 definió los contratos de eventos, DECOR-30 configuró RLS, canales privados y fronteras de service role, DECOR-32 implementó la outbox transaccional y el drenado inicial, DECOR-33 el consumidor idempotente de presupuesto, y DECOR-31 los reintentos, observabilidad y reconciliación ante fallos. Aunque cada componente cuenta con pruebas aisladas, el proyecto carece de una suite unificada y determinista que demuestre conjuntamente las garantías integradas de atomicidad, seguridad, idempotencia y recuperación requeridas para la Entrega 1 (DECOR-34).

## What Changes

- Crear una suite consolidada de pruebas (`tests/events-security-recovery.test.ts`) ejecutada mediante `@electric-sql/pglite` con las migraciones completas aplicadas, sin depender de servicios externos y repetible desde limpio.
- Cubrir de manera explícita la matriz de fixtures:
  - Usuario A, Usuario B, Anónimo.
  - Paquete A, Paquete B.
  - Evento v1 válido, evento versión desconocida, evento duplicado, evento pendiente.
- Demostrar los 4 pilares:
  1. **Atomicidad:** `commit_package_change` (paquete + outbox) y `process_budget_event` (presupuesto + processed_events).
  2. **Idempotencia y Desorden:** Eventos duplicados ignorados sin doble cálculo; eventos con versión anterior sin alterar el total vigente; eventos de versión de contrato desconocida rechazados.
  3. **Seguridad y Autorización Negativa:** Aislamiento de lectura A/B/anónimo en `packages`, `package_items` y `budgets`; esquemas y tablas privadas (`private.domain_events`, `private.processed_events`) inaccesibles al cliente; canales Realtime restringidos exclusivamente al dueño; ausencia de dependencias de `service_role` en código cliente.
  4. **Fallo, Concurrencia y Recuperación:** 2 drainers concurrentes sin duplicación (`FOR UPDATE SKIP LOCKED`); retención en `pending` ante fallo transitorio; transición a `failed` tras 3 reintentos fallidos; reconciliación idempotente que detecta drift y ajusta el presupuesto sin duplicar totales.

## Capabilities

### New Capabilities

- `test-events-security-recovery`: Suite integral de pruebas sobre PostgreSQL en memoria que demuestra formalmente las garantías de atomicidad, idempotencia de eventos, autorización negativa por RLS/schemas privados/canales y recuperación determinista.

### Modified Capabilities

Ninguna. No se modifican contratos de eventos, esquemas de tablas ni rutas de API existentes; se valida la integración de las capacidades provistas por DECOR-29, DECOR-30, DECOR-31, DECOR-32 y DECOR-33.

## Impact

- Añade la suite de pruebas `tests/events-security-recovery.test.ts` ejecutable con `npm test`.
- No introduce nuevas dependencias de producción.
- No modifica esquemas ni migraciones de Supabase.
