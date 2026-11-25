# Quotes

Cotizaciones versionadas con precios congelados (DECOR-50). Cada versión es una instantánea inmutable de un evento (`public.packages`): cambiar el evento o el catálogo después no altera ninguna versión guardada.

- `domain`:
  - `calculateQuote`: líneas y totales con aritmética entera en COP. Las tasas van en puntos básicos (1 % = 100). Redondea al peso con la mitad hacia arriba. Orden: descuento sobre el subtotal, impuesto sobre la base y anticipo sobre el total.
  - `validarTerminosCotizacion`: vigencia (ISO, no pasada en America/Bogota), tasas, condiciones y cliente opcional.
  - Máquina de estados: `draft → sent | expired` y `sent → accepted | expired`. `accepted` y `expired` son finales.
  - `canShareQuote` / `resolveShareExpiry` (DECOR-53): solo `sent`/`accepted` se puede compartir; la vigencia de un enlace nunca supera el fin del día (America/Bogota) de `validUntil`.
- `application`:
  - Casos de uso: `CreateQuoteUseCase` (versión 1), `CreateQuoteVersionUseCase` (mismo número, versión siguiente, releyendo el evento actual), `ChangeQuoteStatusUseCase` y `ListQuotesUseCase`.
  - Casos de uso del enlace público (DECOR-53): `CreateQuoteShareLinkUseCase` (idempotente), `GetQuoteShareLinkUseCase`, `RevokeQuoteShareLinkUseCase` y `GetSharedQuoteUseCase` (lectura sin sesión).
  - Puertos: `QuoteSourceReader`, `QuoteRepository`, `QuoteReader`, `QuoteShareLinkRepository`, `SharedQuoteReader` y `ShareTokenSigner`.
  - `QuoteDto` es el contrato que consumen vista previa (DECOR-51) y PDF (DECOR-52). `PublicQuoteDto` es el mismo contrato reducido que consume el enlace público (DECOR-53): sin `id`, `packageId`, `status` ni `moduleId` por línea.
- `infrastructure` (server-only):
  - `SupabaseQuoteReader`: cliente de sesión, con RLS del dueño.
  - `SupabaseQuoteSourceReader`: service_role, porque el catálogo solo expone módulos activos. Filtra por dueño y agrupa `package_items` por módulo, ya que hay una fila por unidad.
  - `SupabaseQuoteRepository`: RPC con service_role.
  - `HmacShareTokenSigner` (DECOR-53): `token = HMAC-SHA256(DECOR_SHARE_LINK_SECRET, linkId)`, determinista; la base de datos solo guarda `sha256(token)`.
  - `SupabaseQuoteShareLinkRepository` / `SupabaseSharedQuoteReader` (DECOR-53): RPC con service_role.

`quotes` no importa `packages`: lee el evento por su propio puerto, igual que `budget`.

## Persistencia (`20261018000000_create_quotes.sql`)

- **`public.quotes`**: una fila por versión, con datos del cliente y del evento, términos y totales copiados. `UNIQUE (owner_id, quote_number, version)`. `package_id` pasa a `NULL` si se borra el evento, y la cotización se conserva.
- **`public.quote_lines`**: nombre, cantidad, precio unitario y subtotal congelados. `module_id` es solo una referencia, sin FK.
- **`private.quote_counters`**: siguiente número por dueño.
- **Disparadores**: solo `status` puede cambiar, y solo por transiciones válidas. Las líneas nunca se actualizan. Error `quote.immutable`.
- **RLS**: `SELECT` solo para el dueño. Ninguna escritura directa de anon/authenticated. `service_role` no puede actualizar ni borrar líneas.
- **RPC** (`SECURITY INVOKER`, `search_path = ''`, solo `service_role`): `create_quote`, `create_quote_version` y `change_quote_status`. Las dos primeras bloquean el evento, exigen la versión leída y comparan la instantánea con `package_items` y `catalog_modules`.
- **DECOR-55** (`20261020000000_decor_55_quote_idempotency_concurrency.sql`): `create_quote` y `create_quote_version` reciben la clave y la huella, y consultan `private.quote_idempotency_keys` bajo el bloqueo del contador del dueño; `create_quote_version` exige `p_expected_version` y `change_quote_status` exige `p_expected_status`. Las firmas anteriores se eliminan: migración y aplicación se despliegan juntas.

## API (`src/interfaces/quotes`)

| Método y ruta | Uso |
|---|---|
| `POST /api/packages/{packageId}/quotes` | Crea la versión 1. Cabecera `Idempotency-Key` (UUID). Cuerpo: `validUntil`, `taxRateBp`, `discountRateBp?`, `depositRateBp?`, `conditions?`, `clientName?` |
| `GET /api/quotes` | Lista las cotizaciones del dueño |
| `GET /api/quotes/{quoteId}` | Una versión con sus líneas |
| `POST /api/quotes/{quoteId}/versions` | Versión nueva del mismo número. Cabecera `Idempotency-Key`. Cuerpo: el de la creación más `expectedVersion` (la última versión que vio el usuario) |
| `PATCH /api/quotes/{quoteId}/status` | Cambia el estado. Cuerpo: `{ "status": "sent", "expectedStatus": "draft" }` |

Los montos que envíe el cliente se ignoran.

| Código | Cuándo |
|---|---|
| 400 | Cuerpo inválido; `idempotency.key_invalid` (falta la clave o no es UUID) |
| 401 | Sin sesión |
| 404 | Recurso ajeno o inexistente (indistinguibles) |
| 409 | El evento cambió mientras se cotizaba (`quote.package_version_conflict`, `quote.snapshot_mismatch`); la cotización cambió desde que el usuario la vio (`quote.version_conflict` con `currentVersion`, `quote.status_conflict` con `currentStatus`) |
| 422 | Regla de negocio violada; `idempotency.key_reused` (la clave ya se usó con otra solicitud) |
| 500 | Error interno, sin detalle |

### Reintentos y concurrencia (DECOR-55)

- **Idempotencia**: la UI genera una `Idempotency-Key` por intención (`src/app/(protected)/quotes/_lib/intent-keys.ts`) y la reutiliza al reintentar la misma solicitud. Un reintento con la misma clave y la misma solicitud responde `201` con la cotización ya creada y la cabecera `Idempotent-Replayed: true`; no consume otro número ni otra versión. `quoteRequestFingerprint` (aplicación) arma la huella canónica de la solicitud y la base de datos guarda sólo su sha256 en `private.quote_idempotency_keys`, por dueño.
- **Concurrencia optimista**: `expectedVersion` y `expectedStatus` evitan que dos pestañas se pisen. Repetir un cambio de estado que ya ocurrió responde `200` sin volver a aplicarlo.
- **Logs**: los controladores registran con el `Logger` inyectado (`serverLogger`), con `correlationId` y sólo el SQLSTATE de un error de base de datos, nunca su detalle. La regla `logger-only` de `scripts/scan-architecture.ts` prohíbe `console.*` en estas capas.

## Enlace público (DECOR-53)

Permite a un cliente sin sesión consultar una cotización `sent` o `accepted`.

- **Migración** (`20261019000000_create_quote_share_links.sql`): `private.quote_share_links` (token nunca guardado, solo `sha256(token)`), índice único parcial `(quote_id) WHERE revoked_at IS NULL`, disparador que revoca el enlace de la versión anterior al crear una nueva, y RPC `service_role`: `create_quote_share_link` (idempotente), `get_quote_share_link`, `revoke_quote_share_link` y `get_shared_quote` (nunca lanza error: un token inválido, vencido, revocado o de una cotización no compartible devuelve `NULL`).
- **API** (`src/interfaces/quotes/quote-share-link-controller.ts`): `POST/GET/DELETE /api/quotes/{quoteId}/share-link`, autenticada, mismo patrón 401/404 que el resto de cotizaciones.
- **Página pública**: `src/app/(public)/c/[token]/page.tsx`, sin sesión, `notFound()` uniforme ante cualquier motivo de rechazo. `src/proxy.ts` añade `/c` a las rutas públicas con `Cache-Control: no-store` y `Referrer-Policy: no-referrer`.
- **Configuración**: `DECOR_PUBLIC_APP_URL` (origen de la URL compartida) y `DECOR_SHARE_LINK_SECRET` (secreto del HMAC; rotarlo invalida todos los enlaces activos a la vez).
- El PDF de la página pública usa `window.print()` mientras no exista una ruta de descarga propia (DECOR-52).
