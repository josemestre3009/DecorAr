# Design

## Context

DECOR-50 crea cotizaciones con `create_quote`/`create_quote_version`, que bloquean `private.quote_counters` del propietario para asignar número y versión. DECOR-53 añadió el enlace público y DECOR-46 la escena con su propia versión. DECOR-31 dejó un `Logger` JSON que pasa todo contexto por `sanitizeLogContext` (claves con token/key/secret, JWT, Bearer, correos), pero los controladores de cotizaciones, enlaces y escena seguían escribiendo con `console.*`. DECOR-33 ya usa un registro de ids procesados (`private.processed_events`) para no duplicar efectos: es el precedente de este cambio.

## Goals / Non-Goals

**Goals:**

- Ningún usuario accede a datos de otro (incluidas las claves de idempotencia).
- Un conflicto no sobrescribe cambios en silencio: versión de cotización, estado y escena.
- Un reintento no duplica números ni versiones de cotización.
- Ningún token, cookie o dato de fila de Postgres llega a los logs de estas capas.

**Non-Goals:**

- Límite de peticiones (rate limiting).
- Ocultar el token de `/c/<token>` en los logs de acceso del hosting (fuera de la aplicación).
- Migrar a `Logger` los módulos de paquetes, plantillas y catálogo.
- UI para guardar la escena (`/scene` sólo tiene API).

## Decisions

### Las garantías viven en el servidor (opción C)

Una defensa sólo en el cliente (deshabilitar el botón, deduplicar por contenido) no protege ante reintentos de red ni dos pestañas. Se descartan: ETag/If-Match (las cotizaciones son filas inmutables por versión; el "recurso" que cambia es el número), la deduplicación heurística por contenido (dos cotizaciones iguales pueden ser intencionales) y una clave primaria generada en el cliente (expone el identificador y no detecta "misma clave, otra solicitud").

### `Idempotency-Key` + registro en base de datos (I1)

- La clave es un UUID por intención; la UI la reutiliza mientras la solicitud (operación, destino, `expectedVersion`, términos) no cambie, y genera otra si cambia.
- La aplicación calcula una huella canónica (`quoteRequestFingerprint`); la base de datos guarda sólo su sha256, nunca la solicitud.
- La clave se consulta **bajo el bloqueo del contador del propietario** y antes de las comprobaciones de versión: un reintento que llega después de que el primer intento confirmó es una repetición, no un conflicto. La fila se inserta en la misma transacción que la cotización: si la creación falla, no queda clave registrada.
- PK `(owner_id, idempotency_key)`: las claves son por propietario y una clave ajena no revela nada.
- Respuesta de una repetición: `201` con la misma cotización y `Idempotent-Replayed: true` (convención de Stripe), para que el cliente no distinga un caso del otro salvo que quiera.

### Concurrencia optimista en el cuerpo JSON (C1)

`expectedVersion` (entero ≥ 1) y `expectedStatus` van en el cuerpo, igual que `expectedSceneVersion` de DECOR-46. El servidor responde `409` con `currentVersion` o `currentStatus` (el `DETAIL` de la excepción SQL) y un mensaje que pide recargar. Un cambio de estado hacia el estado en que la cotización ya está es un éxito sin escritura (reintento de "marcar enviada").

### Firmas nuevas, no parámetros opcionales

Las funciones antiguas se eliminan (`DROP FUNCTION`) en lugar de añadir parámetros con valor por defecto: un despliegue parcial falla de forma visible en vez de omitir las garantías. Implica desplegar migración y aplicación a la vez.

### Logs

`serverLogger` se crea una vez en la composición y se inyecta en los controladores y en `quote-access`. Los errores 500 registran el código de dominio y sólo el SQLSTATE (`dbCode`), nunca `details`/`message` de Postgres. `uncaughtRouteError` centraliza el 500 de las rutas con `correlationId`. `scan-architecture` añade la regla `logger-only` para estas carpetas.

## Risks / Trade-offs

- **Contrato de API incompatible** → los clientes existentes deben enviar la clave y los campos esperados; se avisa a frontend (Mei) y se despliega junto.
- **Crecimiento del registro de claves** → una fila por cotización creada, borrada en cascada con ella; no requiere limpieza aparte.
- **Carreras reales no probadas en PGlite** (una sola conexión) → la serialización la da el `FOR UPDATE` del contador; se prueba en secuencia y queda la prueba de integración con Supabase real (opt-in).
- **Token en logs de acceso del hosting** y **sin rate limiting** → riesgos aceptados y documentados en `docs/security-v2.md`.
