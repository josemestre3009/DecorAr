# Proposal

## Why

La V2 (eventos, escena, cotizaciones y enlace público) ya aísla los datos por propietario, pero tiene tres huecos que DECOR-55 debe cerrar antes de abrirla a más usuarios:

- **Reintentos con efectos comerciales duplicados.** `POST /api/packages/{id}/quotes` y `POST /api/quotes/{id}/versions` no son idempotentes: si la respuesta se pierde (red móvil, doble clic, reintento del navegador) se asigna otro número de cotización u otra versión.
- **Sobrescritura silenciosa.** Crear una versión toma "la última" sin comprobar cuál vio el usuario, y cambiar el estado no comprueba el estado de partida: dos pestañas pueden pisarse sin aviso. `save_package_scene` aún acepta una versión esperada `NULL`, que omite el control de concurrencia de DECOR-46.
- **Logs con datos sensibles.** Los controladores de cotizaciones, enlaces y escena escriben con `console.*` el error crudo (incluido el `details` de Postgres o un mensaje con el token), sin pasar por el `Logger` sanitizado de DECOR-31.

## What Changes

- Exigir la cabecera `Idempotency-Key` (UUID) en las dos creaciones de cotización. La base de datos guarda la clave por propietario con la huella sha256 de la solicitud: el mismo reintento devuelve la cotización ya creada (`201` + `Idempotent-Replayed: true`); la misma clave con otra solicitud responde `422 idempotency.key_reused`; una clave ausente o inválida, `400 idempotency.key_invalid`.
- Exigir `expectedVersion` en el cuerpo de `POST /api/quotes/{id}/versions` y `expectedStatus` en `PATCH /api/quotes/{id}/status`. Un valor obsoleto responde `409 quote.version_conflict` (con `currentVersion`) o `409 quote.status_conflict` (con `currentStatus`) sin escribir nada. Repetir un cambio de estado que ya ocurrió devuelve la cotización sin volver a aplicarlo.
- Hacer obligatoria la versión esperada en `save_package_scene` (sin valor por defecto; `NULL` o negativa → `scene.invalid_body`).
- Registrar en cotizaciones, enlaces, escena y sus rutas sólo con el puerto `Logger` (JSON sanitizado), sin el detalle crudo de Postgres; una regla de `scan-architecture` impide volver a usar `console.*` en esas capas.
- La UI genera una clave por intención y la reutiliza al reintentar la misma solicitud; muestra el mensaje de conflicto ("Recarga…") sin navegar.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `versioned-quotes`: se añaden "Creación idempotente", "Concurrencia optimista de versiones y estados" y "Logs sin datos sensibles" (que aplica el `Logger` sanitizado de DECOR-31 a cotizaciones, enlaces y escena); se amplía "Acceso exclusivo del propietario" con el aislamiento de las claves de idempotencia.
- `scene-transforms`: "Conflicto de versión de escena" pasa a exigir la versión también en la base de datos.

## Impact

- Nueva migración `20261020000000_decor_55_quote_idempotency_concurrency.sql`: tabla `private.quote_idempotency_keys`, funciones privadas de repetición/registro y nuevas firmas de `create_quote`, `create_quote_version`, `change_quote_status` y `save_package_scene` (las anteriores se eliminan; `EXECUTE` sólo para `service_role`).
- **Cambio de contrato de la API** (avisar a frontend/Mei): cabecera `Idempotency-Key` y campos `expectedVersion`/`expectedStatus` obligatorios. La aplicación y la migración deben desplegarse juntas.
- `src/modules/quotes`: `parseIdempotencyKey`, `quoteRequestFingerprint`, `CreatedQuoteResultDto` y los casos de uso de crear, versionar y cambiar estado.
- `src/interfaces/quotes`, `src/interfaces/ar`, `src/interfaces/http/uncaught-route-error.ts`, las rutas de cotizaciones y escena, y `serverLogger` en `src/composition/server.ts`.
- `src/app/(protected)/quotes/_lib` (`intent-keys.ts`, `quotes-client.ts`) y los formularios de crear, actualizar y enviar.
- Suite PGlite `decor-55-concurrency-idempotency.test.ts`; `supabase/reset-test-database.sql` limpia el registro de claves.
- Fuera de alcance: límite de peticiones, logs de acceso del hosting y una UI para `/scene`. El visor AR individual no cambia.
