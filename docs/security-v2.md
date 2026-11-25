# Seguridad, concurrencia y recuperación de la V2 (DECOR-55)

Este documento resume qué garantiza la V2 (eventos, escena, cotizaciones y enlace público), dónde se garantiza y cómo se prueba. Detalle de diseño: `openspec/changes/decor-55-seguridad-concurrencia-v2/`.

## 1. Ningún usuario accede a datos de otro

| Capa | Mecanismo | Prueba |
|---|---|---|
| HTTP | Sesión obligatoria; `checkPackageAccess` / `checkQuoteAccess` responden 404 ante un recurso ajeno (igual que uno inexistente) | Pruebas de controladores y rutas en `src/interfaces` y `src/app/api` |
| RPC | Cada función filtra por `owner_id`/`user_id`; `EXECUTE` sólo para `service_role` | `decor-50-quotes`, `decor-53-share-links`, `decor-55-concurrency-idempotency`, `create-package-scene-transforms` (PGlite) |
| Tablas | RLS de lectura sólo para el dueño; sin escrituras de `anon`/`authenticated`; tablas internas en `private` | Mismas suites PGlite; `supabase/tests/authorization-ab.integration.test.ts` contra Supabase real (opt-in) |
| Idempotencia | Clave primaria `(owner_id, idempotency_key)`: la clave de otro usuario no devuelve su cotización | `decor-55-concurrency-idempotency.test.ts` |

## 2. Un conflicto no sobrescribe en silencio

| Operación | Control | Respuesta |
|---|---|---|
| Nueva versión de cotización | `expectedVersion` (última versión vista) | `409 quote.version_conflict` + `currentVersion` |
| Cambio de estado | `expectedStatus` (estado visto) | `409 quote.status_conflict` + `currentStatus`; repetir un cambio ya hecho → `200` sin cambios |
| Guardar escena | `expectedSceneVersion`, obligatoria también en la base de datos | `409 scene.version_conflict` + versión actual; `NULL` → `scene.invalid_body` |
| Crear cotización / añadir elementos | Versión del evento (`packages.version`) | `409 quote.package_version_conflict` / `package.version_conflict` |

La UI muestra el mensaje ("Recarga…") y no navega.

## 3. Un reintento no duplica efectos comerciales

- `POST /api/packages/{id}/quotes` y `POST /api/quotes/{id}/versions` exigen `Idempotency-Key` (UUID).
- Misma clave y misma solicitud → `201` con la misma cotización (en su estado actual) y `Idempotent-Replayed: true`; no se asigna otro número ni otra versión.
- Misma clave con otra solicitud → `422 idempotency.key_reused`. Sin clave o inválida → `400 idempotency.key_invalid`.
- La clave se consulta bajo el bloqueo del contador del dueño (`FOR UPDATE`), de modo que un reintento concurrente espera y luego ve la clave confirmada. La fila del registro se escribe en la misma transacción que la cotización. Si el evento se borró, quedó vacío o la vigencia ya caducó antes de llamar al RPC, las validaciones previas devuelven error antes de consultar el registro.
- La UI reutiliza la clave mientras la solicitud no cambie y genera otra si el usuario cambia los datos.
- Ya eran idempotentes: el enlace público (`create_quote_share_link`) y el consumidor de presupuesto (`private.processed_events`, DECOR-33).

## 4. Logs sin tokens ni datos sensibles

- Cotizaciones, enlaces, escena y sus rutas registran con el puerto `Logger` (`serverLogger`, JSON). Todo contexto pasa por `sanitizeLogContext`, que censura claves con `token`, `key`, `secret`, `password`, `authorization`, `cookie`… y valores con forma de JWT, `Bearer` o correo.
- Los errores de base de datos se registran con el código de dominio y el SQLSTATE (`dbCode`), nunca con `details`/`message` de Postgres (pueden traer valores de la fila).
- El token del enlace y la URL pública nunca se registran; la base de datos sólo guarda `sha256(token)`.
- La regla `logger-only` de `scripts/scan-architecture.ts` impide usar `console.*` en esas carpetas.

## Riesgos aceptados

- **Token en logs de acceso del hosting**: la ruta `/c/<token>` aparece en los logs de acceso de la plataforma, fuera del control de la aplicación. Mitigación: tokens revocables, con vigencia acotada, `Cache-Control: no-store` y `Referrer-Policy: no-referrer`.
- **Sin límite de peticiones** (rate limiting) en la aplicación; queda para una tarea aparte.
- **`/api/packages/{id}/scene` sin UI**: el control de concurrencia se prueba sólo por API.
- **Despliegue sincronizado**: las firmas de las RPC cambiaron; la migración y la aplicación deben desplegarse juntas.
- **Cambio de contrato de API**: los clientes deben enviar `Idempotency-Key`, `expectedVersion` y `expectedStatus` (aviso a frontend).
- **Carreras reales**: PGlite tiene una sola conexión, así que las carreras se prueban en secuencia; la serialización real la da `FOR UPDATE` en PostgreSQL.
- Los módulos de paquetes, plantillas y catálogo, las páginas SSR de vista previa (`/quotes/[quoteId]` y `/c/[token]`, que sólo registran código/título) y `react-pdf-quote-renderer` siguen usando `console.*` fuera de `LOGGER_ONLY_ROOTS`.
