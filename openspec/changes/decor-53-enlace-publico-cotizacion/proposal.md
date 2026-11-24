# Proposal

## Why

El cliente de un evento no tiene sesión en DecorAR, pero necesita revisar su cotización. Hoy `GET /api/quotes/{id}` y la vista previa (DECOR-51) exigen sesión del propietario; no existe ningún camino público. DECOR-53 añade un enlace que el propietario crea, comparte y revoca, sin abrir la API de cotizaciones a usuarios anónimos.

## What Changes

- Añadir una tabla privada `quote_share_links`, separada de `quotes`, con un enlace activo por cotización, vigencia y revocación.
- Generar el token con HMAC-SHA256 sobre un identificador de enlace; la base de datos guarda solo su hash, nunca el token.
- Permitir crear el enlace sólo si la cotización está `sent` o `accepted`; crear una versión nueva revoca automáticamente el enlace de la versión anterior.
- Exponer `POST/GET/DELETE /api/quotes/{quoteId}/share-link`, autenticado y restringido al propietario, para crear (idempotente), consultar y revocar el enlace.
- Exponer una página pública `/c/{token}` que muestra una vista reducida de la cotización (sin AR, PDF ni datos internos) y responde igual ante un token inválido, vencido o revocado.
- Registrar la creación y la revocación sin guardar el token ni su hash en los logs.

## Capabilities

### New Capabilities

Ninguna. El enlace público es parte de `versioned-quotes` (DECOR-50): comparte la misma cotización y las mismas reglas de propietario.

### Modified Capabilities

- `versioned-quotes`: se añade el requisito "Enlace público revocable" y se amplía "Acceso exclusivo del propietario" para aceptar, además de la sesión del propietario, un enlace público vigente como vía de lectura.

## Impact

- Nueva migración `20261019000000_create_quote_share_links.sql`: tabla `private.quote_share_links`, índice único parcial, disparador que revoca el enlace de la versión anterior al crear una nueva, y RPC `service_role` (`create_quote_share_link`, `get_quote_share_link`, `revoke_quote_share_link`, `get_shared_quote`).
- Nuevo módulo de dominio y aplicación dentro de `src/modules/quotes`: `QuoteShareLinkRepository`, `ShareTokenSigner`, `PublicQuoteDto` y los casos de uso de crear, consultar y revocar el enlace, y de leer la cotización compartida.
- Nuevo `QuoteShareLinkController` en `src/interfaces/quotes`, rutas `src/app/api/quotes/[quoteId]/share-link`, página pública `src/app/(public)/c/[token]/page.tsx` y las fábricas correspondientes en `src/composition/server.ts`.
- `src/proxy.ts` añade `/c` a las páginas públicas y cabeceras anti-caché/anti-referrer para esa ruta.
- Nuevas variables `DECOR_PUBLIC_APP_URL` y `DECOR_SHARE_LINK_SECRET` en `src/lib/env.ts` y `.env.example`.
- `QuotePreview` (DECOR-51) se adapta para aceptar también el DTO público, sin mostrar el estado de la cotización.
- `supabase/reset-test-database.sql` limpia la tabla nueva; suite PGlite `decor-53-share-links.test.ts` registrada en `vitest.config.ts`.
- El PDF descargable (DECOR-52) queda fuera de esta entrega; la página pública usa `window.print()` como en la vista previa del propietario.
