# Design

## Context

DECOR-50 guarda cada versión de una cotización como una fila inmutable de `public.quotes`, legible solo bajo RLS del propietario. DECOR-51 añadió la vista previa (`QuoteDto` → `QuotePreview`), que el PDF (DECOR-52) y el enlace público (DECOR-53) reutilizan según `src/modules/quotes/README.md`. No existe en el repositorio ningún mecanismo de token, enlace público o firma: ni `crypto.randomBytes`, ni `createHash`, ni rutas fuera del listado fijo de `src/proxy.ts`. El único precedente de secreto compartido (`/api/internal/recovery`, comparado con `timingSafeEqual`) ya se eliminó.

## Goals / Non-Goals

**Goals:**

- Un cliente sin sesión puede ver una cotización vigente a través de un enlace que el propietario controla.
- El token nunca se guarda ni se registra; solo su hash permite encontrar el enlace.
- Un enlace vencido, revocado o de una cotización que no está en `sent`/`accepted` responde igual que uno inválido.
- Reintentar la creación no produce dos enlaces activos para la misma cotización.
- Crear una versión nueva invalida el enlace de la versión anterior sin que el cliente lo note como un error distinto.

**Non-Goals:**

- PDF descargable con URL propia (DECOR-52); la página pública usa `window.print()` mientras tanto.
- Límite de peticiones (rate limiting) a nivel de aplicación; se deja anotado para DECOR-55.
- Registro de cada acceso de lectura (solo se registra creación y revocación).
- Enlaces múltiples por cotización o enlaces "siempre a la última versión".

## Decisions

### 1. Token HMAC, hash en la base de datos

El servidor genera un `linkId` (uuid) y calcula `token = base64url(HMAC-SHA256(DECOR_SHARE_LINK_SECRET, linkId))`. La tabla guarda `token_hash = sha256(token)` con índice único; el token nunca se persiste. Leer un enlace compartido vuelve a calcular `token` a partir del `linkId` únicamente para que el propietario pueda volver a copiarlo sin que el servidor "recuerde" el secreto en texto plano en ningún otro lugar; la consulta pública busca por `sha256(token recibido)`.

Alternativa descartada: guardar el token aleatorio en texto plano. Expondría todos los enlaces activos ante una filtración de la base de datos.

### 2. Un enlace activo por cotización, creación idempotente

Índice único parcial `(quote_id) WHERE revoked_at IS NULL`. `create_quote_share_link` bloquea la cotización (`FOR SHARE`), valida `status IN ('sent','accepted')` (`quote.share_not_allowed`) y:

- si hay un enlace activo y vigente, lo devuelve sin crear otro (idempotencia ante reintentos y doble clic);
- si el enlace activo ya venció, lo marca revocado y crea uno nuevo.

Alternativa descartada: una clave de idempotencia enviada por el cliente. La cotización ya es la clave natural: un enlace por cotización es justamente la regla que pide el ticket.

### 3. Revocación automática al versionar

Un disparador `AFTER INSERT ON public.quotes` revoca (`revoked_at = now()`) el enlace activo de cualquier otra fila con el mismo `(owner_id, quote_number)`. No se modifica `create_quote_version`: el trigger ve la nueva versión y resuelve las anteriores por número, sin acoplar el módulo `quotes` al módulo `quote_share_links` en el código de aplicación.

### 4. Vigencia acotada por `valid_until`

`resolveShareExpiry` (dominio puro) nunca deja que `expires_at` supere el fin del día (America/Bogota) de `quote.validUntil`. Sin fecha propuesta, usa ese mismo límite. El propietario no puede extender un enlace existente: debe revocar y crear uno nuevo, igual que con las versiones.

### 5. Lectura pública por una sola RPC `service_role`

`get_shared_quote(p_token_hash)` devuelve `private.quote_json` solo si el enlace no está revocado, no venció y la cotización sigue en `sent`/`accepted`; en cualquier otro caso devuelve `NULL`. `anon` sigue sin permisos sobre `quotes`/`quote_share_links` (regla de DECOR-30); la ruta pública usa el cliente `service_role` en el servidor, nunca desde el navegador.

Alternativa descartada: política RLS para `anon` sobre `quotes` filtrada por un token en una cabecera o variable de sesión. Es más difícil de auditar que una RPC explícita y abriría una vía de lectura directa a la tabla de negocio, que DECOR-30 prohíbe.

### 6. DTO público reducido

`PublicQuoteDto` reutiliza los mismos campos de cliente, evento, vigencia, condiciones, tasas, totales y líneas que `QuoteDto`, pero omite `id`, `ownerId`, `packageId`, `sourcePackageVersion`, `status`, `moduleId` de cada línea y las marcas de tiempo. `QuotePreview` se adapta para aceptar ambos DTOs; el estado solo se muestra cuando está presente.

### 7. Error uniforme y cabeceras

Un token con formato inválido, inexistente, vencido, revocado o de una cotización no compartible todos producen la misma página `notFound()`. La ruta `/c/[token]` se añade a `PUBLIC_PAGE_PREFIXES` en `src/proxy.ts`, con `Cache-Control: no-store` y `Referrer-Policy: no-referrer` para que el token no quede en cachés intermedias ni en el encabezado `Referer` de saltos posteriores. Los metadatos de la página son genéricos (sin nombre de cliente ni montos) para no filtrar datos en la vista previa que generan WhatsApp u otros clientes al descargar la URL.

## Risks / Trade-offs

- Sin límite de peticiones, un token filtrado por otro canal (captura de pantalla del enlace, historial del navegador) sigue siendo válido hasta que se revoque o venza; 256 bits de entropía hacen inviable adivinarlo por fuerza bruta, pero no mitigan una filtración directa del enlace.
- `DECOR_SHARE_LINK_SECRET` es un secreto nuevo del servidor: rotarlo invalida todos los enlaces activos a la vez, lo cual sirve como interruptor de emergencia pero no permite invalidar solo uno.
- El PDF de la página pública depende de `window.print()` hasta que DECOR-52 defina el renderizador; no hay URL de descarga propia en esta entrega.
