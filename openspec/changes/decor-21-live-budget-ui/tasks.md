# Tasks

## 1. Cliente HTTP y contratos de sincronización
- [x] 1.1 Crear puerto `BudgetClient` y fábrica `createHttpBudgetClient` en `src/app/(protected)/packages/_lib/budget-client.ts`.
- [x] 1.2 Añadir pruebas unitarias completas en `src/app/(protected)/packages/_lib/budget-client.test.ts`.

## 2. Hook reactivo Realtime y resincronización
- [x] 2.1 Crear `useLiveBudget` en `src/app/(protected)/packages/_lib/use-live-budget.ts` con deduplicación por `eventId`, descarte de versiones viejas, resync en reconexión, online, visibilidad y huecos.
- [x] 2.2 Añadir pruebas unitarias completas en `src/app/(protected)/packages/_lib/use-live-budget.test.ts`.

## 3. Integración en UI y accesibilidad
- [x] 3.1 Actualizar `BudgetTotal` (`budget-total.tsx`) como Client Component con `aria-live="polite"`, estado de actualización no bloqueante y retención del último confirmado ante fallos.
- [x] 3.2 Pasar `packageId` a `BudgetTotal` desde `PackagePage` (`page.tsx`).
- [x] 3.3 Extender `budget-total.test.tsx` para cubrir eventos en vivo, alertas y reintentos.

## 4. Verificación
- [x] 4.1 Ejecutar `npm run typecheck`, `npm run lint`, `npm test` y `npm run build`.
- [x] 4.2 Validar límites arquitectónicos con `scripts/scan-architecture.test.ts` y `scripts/service-role-boundary.test.ts`.
