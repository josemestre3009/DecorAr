# Tasks

## 1. Persistencia

- [x] 1.1 Crear la migración `20261020000000_decor_55_quote_idempotency_concurrency.sql` (registro `private.quote_idempotency_keys`, funciones de repetición/registro, nuevas firmas de `create_quote`, `create_quote_version`, `change_quote_status` y `save_package_scene`); verificar con la suite PGlite `decor-55-concurrency-idempotency.test.ts`.
- [x] 1.2 Adaptar a las firmas nuevas las suites `decor-50-quotes`, `decor-53-share-links` y `create-package-scene-transforms`; registrar la suite nueva en `vitest.config.ts` y limpiar el registro en `supabase/reset-test-database.sql`.

## 2. Dominio y aplicación

- [x] 2.1 Crear `parseIdempotencyKey` y `quoteRequestFingerprint`; verificar con pruebas unitarias.
- [x] 2.2 Exigir clave en crear/versionar, `expectedVersion` en versionar y `expectedStatus` en cambiar estado; devolver `CreatedQuoteResultDto`; verificar con dobles de prueba.

## 3. Infraestructura

- [x] 3.1 Pasar los argumentos nuevos en `SupabaseQuoteRepository`, mapear `quote.version_conflict`/`quote.status_conflict` (con el `DETAIL` como metadato) y no exponer el texto crudo de Postgres.

## 4. HTTP, composición y logs

- [x] 4.1 Leer `Idempotency-Key`, `expectedVersion` y `expectedStatus` en `QuoteController`; responder 400/409/422 y `Idempotent-Replayed: true`.
- [x] 4.2 Crear `serverLogger` en `src/composition/server.ts` e inyectarlo en los controladores de cotizaciones, enlaces y escena y en `quote-access`; centralizar el 500 de las rutas en `uncaughtRouteError`.
- [x] 4.3 Añadir la regla `logger-only` a `scripts/scan-architecture.ts`; verificar con `scan-architecture.test.ts`.

## 5. UI

- [x] 5.1 Crear `intent-keys.ts` y enviar la clave, `expectedVersion` y `expectedStatus` desde `QuotesClient` y los formularios; verificar que un reintento reutiliza la clave y que un 409 muestra "Recarga".

## 6. Cierre

- [x] 6.1 Documentar el contrato y los riesgos aceptados en `docs/security-v2.md` y `src/modules/quotes/README.md`.
- [x] 6.2 Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
