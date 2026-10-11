# Proposal

## Why

DECOR-21 pide que la interfaz de usuario reciba el presupuesto confirmado en tiempo real mediante Broadcast privado o resincronización por API, asegurando una experiencia interactiva sin bloquear el catálogo y manteniendo Clean Architecture:
- La UI debe conectarse al canal privado `package:{packageId}` utilizando exclusivamente Auth y Broadcast privado sobre `supabase-js`, sin `postgres_changes` ni acceso directo a tablas.
- Al agregar o quitar elementos, la UI muestra el estado "Actualizando presupuesto…", ignorando duplicados por `eventId` o versiones obsoletas.
- Al recibir `budget.recalculated`, actualiza el total en pantalla y lo comunica de manera accesible con `aria-live="polite"`.
- Ante reconexión, regreso a la pestaña (`visibilitychange`), recuperación de red (`online`) o huecos de versión, se resincroniza invocando `GET /api/packages/{id}/budget`.
- Ante fallos de conexión o sincronización, se preserva en pantalla el último total confirmado conocido.

## What Changes

- Añadir el cliente HTTP de presupuesto `BudgetClient` en `src/app/(protected)/packages/_lib/budget-client.ts` para consumir `GET /api/packages/{packageId}/budget` de forma desacoplada y tipada.
- Añadir el hook reactivo `useLiveBudget` en `src/app/(protected)/packages/_lib/use-live-budget.ts`, que gestiona la suscripción a `subscribeToPackageChannel`, deduplicación por `eventId`, resincronización por eventos del navegador/reconexión y retención del último presupuesto confirmado ante errores.
- Actualizar `BudgetTotal` (`src/app/(protected)/packages/[packageId]/budget-total.tsx`) como Client Component con accesibilidad (`aria-live="polite"`), feedback no bloqueante de actualización y reintento.
- Pasar `packageId` a `BudgetTotal` desde `PackagePage` (`src/app/(protected)/packages/[packageId]/page.tsx`).
- Añadir suite de pruebas exhaustivas para `budget-client.test.ts`, `use-live-budget.test.ts` y expandir `budget-total.test.tsx`.

## Capabilities

### New Capabilities

- `live-budget-ui`: recepción en tiempo real de presupuestos confirmados vía Broadcast privado de Supabase, con resincronización automática y tolerancia a fallos en el configurador.

### Modified Capabilities

- Ninguna. No se alteran contratos existentes de backend ni migraciones; solo se consumen los contratos de DECOR-29, DECOR-30 y DECOR-33.

## Impact

- Código nuevo en `src/app/(protected)/packages/_lib` y actualización de `src/app/(protected)/packages/[packageId]`.
- Respeta estrictamente los límites de Clean Architecture: `packages-budget-coupling`, `client-business-crud` y `client-server-import`.
