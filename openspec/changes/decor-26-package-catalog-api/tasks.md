# Tasks

## 1. Script SQL de reseteo server-side
- [x] 1.1 Crear `supabase/reset-test-database.sql` para limpieza transaccional de tablas mutables.
- [x] 1.2 Crear runner ejecutable para Supabase alojado en `scripts/run-package-api-integration.ts`.

## 2. Suite de integración de API, persistencia y patrones
- [x] 2.1 Crear `tests/package-catalog-api.test.ts` con PGlite, migraciones desde cero y aislamiento por reseteo server-side.
- [x] 2.2 Probar catálogo (`GET /api/modules`): 200 OK y caché.
- [x] 2.3 Probar Builder: Fixture salón social, Fixture Director, Fixture capacidad excedida (422) sin eventos en outbox, y rollback atómico.
- [x] 2.4 Probar Prototype: clonación profunda (`POST /clone`) e independencia de modificaciones/borrados.
- [x] 2.5 Probar Composite: Zona de bienvenida (`POST /groups`), 3 niveles admitidos, 4to nivel rechazado (422), y prevención de ciclos.
- [x] 2.6 Probar seguridad y ownership A/B: rechazo anónimo (401), aislamiento de Usuario B frente a Usuario A (404).
- [x] 2.7 Probar manejo de errores controlados (400, 404, 422, 500) y trazabilidad con `x-correlation-id`.

## 3. Colección de solicitudes HTTP y documentación
- [x] 3.1 Crear `tests/package-catalog-api.http` con colección ejecutable de peticiones.
- [x] 3.2 Documentar evidencias, ubicación de fixtures y diagrama de patrones en `docs/DecorAR.md`.

## 4. Verificación
- [x] 4.1 Ejecutar `npm run typecheck`, `npm run lint`, `npm test` y `npm run build`.
- [x] 4.2 Validar OpenSpec `decor-26-package-catalog-api` en modo estricto.
