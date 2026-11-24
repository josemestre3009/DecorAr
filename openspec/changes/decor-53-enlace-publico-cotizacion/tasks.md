# Tasks

## 1. Persistencia

- [x] 1.1 Crear la migración `quote_share_links` (tabla privada, índice único parcial, disparador de revocación al versionar, RPC `create_quote_share_link`/`get_quote_share_link`/`revoke_quote_share_link`/`get_shared_quote`); verificar con la suite PGlite `decor-53-share-links.test.ts`.
- [x] 1.2 Registrar la suite en `vitest.config.ts` y limpiar la tabla en `supabase/reset-test-database.sql`; verificar con `npm test`.

## 2. Dominio y aplicación

- [x] 2.1 Crear `canShareQuote` y `resolveShareExpiry` en `src/modules/quotes/domain`; verificar con pruebas de estado y límite de vigencia.
- [x] 2.2 Crear `PublicQuoteDto`, los puertos `QuoteShareLinkRepository`/`ShareTokenSigner` y los casos de uso de crear, consultar, revocar y leer el enlace compartido; verificar con dobles de prueba.

## 3. Infraestructura

- [x] 3.1 Crear `HmacShareTokenSigner` (`node:crypto`) y `SupabaseQuoteShareLinkRepository`; verificar firma, hash y mapeo de errores de las RPC.
- [x] 3.2 Añadir `DECOR_PUBLIC_APP_URL` y `DECOR_SHARE_LINK_SECRET` a `src/lib/env.ts` y `.env.example`.

## 4. HTTP y composición

- [x] 4.1 Crear `QuoteShareLinkController` y las rutas `POST/GET/DELETE /api/quotes/[quoteId]/share-link`; verificar 401, 404, 409 y 422 sin filtrar detalle.
- [x] 4.2 Añadir `createQuoteShareLinkController` y `createSharedQuoteQueryDependencies` en `src/composition/server.ts`.

## 5. Página pública y UI del propietario

- [x] 5.1 Adaptar `QuotePreview` para aceptar `PublicQuoteDto` (estado opcional); verificar con las pruebas existentes.
- [x] 5.2 Crear `src/app/(public)/c/[token]/page.tsx` con metadatos genéricos, `notFound()` uniforme y botón de impresión; añadir `/c` a `src/proxy.ts` con `Cache-Control: no-store` y `Referrer-Policy: no-referrer`.
- [x] 5.3 Añadir a `quote-actions.tsx` las acciones de crear/copiar/revocar enlace, visibles solo con estado `sent` o `accepted`.

## 6. Cierre

- [x] 6.1 Documentar el flujo en `docs/architecture.md` y `src/modules/quotes/README.md`.
- [x] 6.2 Ejecutar `npm run lint`, `npm run typecheck` y `npm test`.
