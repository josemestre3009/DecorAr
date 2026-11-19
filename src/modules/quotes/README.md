# Quotes

Cotizaciones versionadas con precios congelados (DECOR-50). Cada versión es una instantánea inmutable de un evento (`public.packages`): cambiar el evento o el catálogo después no altera ninguna versión guardada.

- `domain`:
  - `calculateQuote`: líneas y totales con aritmética entera en COP. Las tasas van en puntos básicos (1 % = 100). Redondea al peso con la mitad hacia arriba. Orden: descuento sobre el subtotal, impuesto sobre la base y anticipo sobre el total.
  - `validarTerminosCotizacion`: vigencia (ISO, no pasada en America/Bogota), tasas, condiciones y cliente opcional.
  - Máquina de estados: `draft → sent | expired` y `sent → accepted | expired`. `accepted` y `expired` son finales.
- `application`:
  - Casos de uso: `CreateQuoteUseCase` (versión 1), `CreateQuoteVersionUseCase` (mismo número, versión siguiente, releyendo el evento actual), `ChangeQuoteStatusUseCase` y `ListQuotesUseCase`.
  - Puertos: `QuoteSourceReader`, `QuoteRepository` y `QuoteReader`.
  - `QuoteDto` es el contrato que consumen vista previa (DECOR-51), PDF (DECOR-52) y enlace público (DECOR-53).
- `infrastructure` (server-only):
  - `SupabaseQuoteReader`: cliente de sesión, con RLS del dueño.
  - `SupabaseQuoteSourceReader`: service_role, porque el catálogo solo expone módulos activos. Filtra por dueño y agrupa `package_items` por módulo, ya que hay una fila por unidad.
  - `SupabaseQuoteRepository`: RPC con service_role.

`quotes` no importa `packages`: lee el evento por su propio puerto, igual que `budget`.

## Persistencia (`20261018000000_create_quotes.sql`)

- **`public.quotes`**: una fila por versión, con datos del cliente y del evento, términos y totales copiados. `UNIQUE (owner_id, quote_number, version)`. `package_id` pasa a `NULL` si se borra el evento, y la cotización se conserva.
- **`public.quote_lines`**: nombre, cantidad, precio unitario y subtotal congelados. `module_id` es solo una referencia, sin FK.
- **`private.quote_counters`**: siguiente número por dueño.
- **Disparadores**: solo `status` puede cambiar, y solo por transiciones válidas. Las líneas nunca se actualizan. Error `quote.immutable`.
- **RLS**: `SELECT` solo para el dueño. Ninguna escritura directa de anon/authenticated. `service_role` no puede actualizar ni borrar líneas.
- **RPC** (`SECURITY INVOKER`, `search_path = ''`, solo `service_role`): `create_quote`, `create_quote_version` y `change_quote_status`. Las dos primeras bloquean el evento, exigen la versión leída y comparan la instantánea con `package_items` y `catalog_modules`.

## API (`src/interfaces/quotes`)

| Método y ruta | Uso |
|---|---|
| `POST /api/packages/{packageId}/quotes` | Crea la versión 1. Cuerpo: `validUntil`, `taxRateBp`, `discountRateBp?`, `depositRateBp?`, `conditions?`, `clientName?` |
| `GET /api/quotes` | Lista las cotizaciones del dueño |
| `GET /api/quotes/{quoteId}` | Una versión con sus líneas |
| `POST /api/quotes/{quoteId}/versions` | Versión nueva del mismo número, con el mismo cuerpo que la creación |
| `PATCH /api/quotes/{quoteId}/status` | Cambia el estado. Cuerpo: `{ "status": "sent" }` |

Los montos que envíe el cliente se ignoran.

| Código | Cuándo |
|---|---|
| 400 | Cuerpo inválido |
| 401 | Sin sesión |
| 404 | Recurso ajeno o inexistente (indistinguibles) |
| 409 | El evento cambió mientras se cotizaba (`quote.package_version_conflict`, `quote.snapshot_mismatch`) |
| 422 | Regla de negocio violada |
| 500 | Error interno, sin detalle |
