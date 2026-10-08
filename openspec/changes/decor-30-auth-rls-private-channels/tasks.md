# Tasks

## 1. PostgreSQL

- [x] 1.1 Crear la migración con RLS de lectura del dueño en `packages` y `package_items`, permisos mínimos del catálogo y su RPC, y la política de `realtime.messages` para `package:{packageId}`
- [x] 1.2 Aplicar las migraciones y verificar A, B y anónimo con roles y funciones de Supabase simulados en `supabase/migrations/authorize-packages-and-private-channels.test.ts`, ejecutado por `npm test`
- [x] 1.3 Confirmar que la outbox sigue en `private` y fijar ahí `processed_events` para DECOR-33

## 2. Autorización en Route Handlers

- [x] 2.1 Añadir `AuthorizePackageAccessUseCase` y `PackageOwnerReader` en `src/modules/packages/application`; verificar A, B, anónimo y RLS deshabilitada con pruebas unitarias
- [x] 2.2 Añadir el lector Supabase server-only y `checkPackageAccess` en `src/interfaces/packages`; verificar 401, 404 y 500 sin filtrar detalle
- [x] 2.3 Exponer `createPackageAccessDependencies()` con el cliente de sesión, nunca con service role; verificar con la prueba de composición
- [x] 2.4 Revisar la compatibilidad del código de sesión de DECOR-38; no requiere cambios

## 3. Realtime en el navegador

- [x] 3.1 Añadir `subscribeToPackageChannel` en la fábrica del navegador: canal privado, `setAuth`, solo `broadcast`, sin publicar ni `postgres_changes`; verificar con `browser.test.ts`

## 4. Service role y fixtures

- [x] 4.1 Añadir `scripts/service-role-boundary.test.ts`; verificar que falla si un Client Component importa la composición
- [x] 4.2 Añadir los fixtures A/B opt-in en `supabase/tests/authorization-ab.integration.test.ts` con la admin API, siguiendo el método de DECOR-38
- [x] 4.3 Ejecutar los fixtures A/B contra el proyecto alojado tras aplicar la migración (`DECOR_RLS_INTEGRATION=1`), y comprobar que "Allow public access" de Realtime está desactivado

## 5. Integración

- [x] 5.1 Documentar la matriz y los límites en `docs/DecorAR.md` y en el README de paquetes
- [x] 5.2 Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`
- [ ] 5.3 Ejecutar `openspec validate decor-30-auth-rls-private-channels --type change --strict` (el CLI no está instalado en el entorno)
