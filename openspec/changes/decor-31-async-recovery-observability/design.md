# Design

## Context

DECOR-32 construyó la outbox `private.domain_events` y `DrainOutboxUseCase`, que reclama solo eventos nunca intentados (`attempts = 0`) con `FOR UPDATE SKIP LOCKED` y los marca `published` tras el éxito; si falla, el evento queda `pending` con `attempts = 1` y su `last_error`, a propósito para que DECOR-31 sea quien reintente. DECOR-33 construyó `process_budget_event`, idempotente por `(consumer, event_id)` y no regresivo por `packageVersion`. Ningún mecanismo de reintento, reconciliación ni logging estructurado existe todavía. Véase `proposal.md` para la motivación.

## Goals / Non-Goals

**Goals:**

- Un fallo transitorio se recupera en un reintento posterior sin intervención manual.
- Un fallo permanente se detiene exactamente tras el tercer reintento (nunca un bucle infinito) y queda identificable para reconciliación.
- La reconciliación relee la fuente de verdad (el paquete persistido) y corrige el presupuesto sin duplicar ni regresar.
- Los logs nunca contienen tokens, cookies, claves, contraseñas, el email completo ni el payload crudo de un evento.
- Un operador puede listar pendientes/fallidos y disparar reintentos o reconciliación sin sesión de usuario, mediante un secreto compartido.
- `correlationId` viaja desde el request HTTP hasta el log del reintento y la reconciliación.

**Non-Goals:**

- UI de recuperación (fuera de alcance, ver `proposal.md`).
- Cambiar el contrato de eventos de DECOR-29 o el intento inicial de DECOR-32.
- Un broker o cola durable real (fuera del MVP, ver `docs/DecorAR.md` sección 2.4).

## Decisions

### Estado `failed` nuevo, no sobrecargar `pending`

`private.domain_events.status` pasa de `('pending', 'published')` a `('pending', 'published', 'failed')`. Un evento que agota los tres reintentos pasa a `failed` mediante `mark_domain_event_failed`, que además exige `published_at IS NULL`. Sin este estado, `pending` mezclaría "nunca intentado", "en curso de reintentos" y "agotado sin esperanza", lo que impediría que `list_retryable_domain_events` seleccione únicamente candidatos vivos y que la reconciliación identifique qué quedó sin resolver.

Alternativa descartada: mantener `pending` con `attempts = 4` como marca de agotado. Es ambiguo con una métrica externa de `attempts` y exige que cada consulta repita la condición `attempts >= 4` en vez de filtrar por estado.

### Reintentos con backoff inyectado, no con elegibilidad temporal en SQL

`RetryOutboxUseCase` recibe un puerto `Sleep` (`wait(ms): Promise<void>`); en producción es `setTimeout` real, en pruebas una función que resuelve inmediatamente y registra las llamadas. Por cada evento `pending` con `attempts` entre 1 y 3, el caso de uso espera `[1000, 2000, 4000][attempts - 1]` antes de reclamarlo. El reclamo (`claim_retry_domain_event`) exige el `attempts` esperado como parámetro: solo lo incrementa si coincide, así que dos workers que reintentan el mismo evento no lo reintentan dos veces ni pisan el contador.

Alternativa descartada: una condición `last_attempt_at + backoff < now()` evaluada en SQL sin espera explícita en el worker. Funcionaría, pero obligaría a invocar el job con una cadencia menor al primer backoff (1 s) para cumplir los tiempos exigidos por `docs/DecorAR.md`, lo que no es realista para un cron externo; la espera inyectada hace el tiempo exacto y explícito, y las pruebas no esperan de verdad.

### Reclamo de reintento condicionado al intento esperado

`claim_retry_domain_event(p_event_id, p_expected_attempts)` solo incrementa `attempts` y actualiza `last_attempt_at` si la fila sigue `pending` y su `attempts` es exactamente el esperado; de lo contrario no hace nada y devuelve `false`. Esto evita que dos workers concurrentes reintenten el mismo evento con el mismo número de intento (el segundo encuentra `attempts` ya incrementado y se retira), análogo al `FOR UPDATE SKIP LOCKED` de `claim_initial_domain_events` pero por fila en vez de por lote, porque cada evento de reintento espera un tiempo distinto según su propio `attempts`.

### Reconciliación como función idempotente separada de `process_budget_event`

`reconcile_budget(p_package_id, p_package_version, p_total_cop)` relee `budgets` y aplica el total recalculado solo si no hay fila, si `p_package_version` es mayor que la almacenada, o si es igual pero el total difiere (corrige una desviación sin exigir una versión más nueva, a diferencia de `process_budget_event` que exige estrictamente mayor). Devuelve `{corrected, package_id, total_cop, package_version, updated_at}`. Una segunda llamada con los mismos valores devuelve `corrected = false`: no reescribe si ya coincide.

Alternativa descartada: reutilizar `process_budget_event` para reconciliar. Esa función exige un `eventId` nuevo y una versión estrictamente mayor, pensada para el flujo normal; forzar la reconciliación por ahí exigiría sintetizar un `eventId` falso, lo que contaminaría `processed_events` con entradas que no corresponden a un evento real.

### Logger sanitizado como adaptador sobre el puerto ya existente

`src/shared/application/ports.ts` ya declara `Logger` (DECOR-16). Este cambio añade `src/infrastructure/logging/json-logger.ts` (adaptador que escribe una línea JSON con `timestamp`, `level`, `message` y el contexto) y `src/shared/application/sanitize-log-context.ts` (función pura): recorre el contexto, trunca/censura claves cuyo nombre contenga `token`, `cookie`, `authorization`, `key`, `secret` o `password`, enmascara un email a `l***@dominio` y nunca incluye el payload crudo de un evento, solo sus identificadores (`eventId`, `packageId`, `correlationId`, `attempt`). El caso de uso de reintentos y el de reconciliación reciben el logger ya sanitizador por construcción: nunca escriben el contexto sin pasarlo por `sanitizeLogContext`.

### Endpoint protegido por secreto Bearer, no por sesión de usuario

No existe un rol "admin" en la aplicación (`member`/`project` de Plane no aplican al runtime). `POST/GET /api/internal/recovery` exige `Authorization: Bearer <valor>` comparado con `DECOR_RECOVERY_SECRET` mediante `crypto.timingSafeEqual` sobre buffers de igual longitud (si la longitud difiere, se rechaza sin comparar). Si la variable de entorno no está configurada, el endpoint responde `503` en vez de aceptar cualquier secreto o quedar abierto. Esto permite invocarlo desde un cron externo (`curl`) sin depender de una cookie de sesión de Supabase.

Alternativa descartada: exigir sesión de Supabase más una lista de correos permitidos. Un cron no tiene sesión de navegador; forzaría a emitir y refrescar un JWT de servicio solo para esto, cuando ya existe `service_role` para la escritura y el endpoint es interno, no de cara al usuario.

### Propagación de `correlationId` sin tocar el contrato de eventos v1

`correlation_id` se añade como columna nullable en `private.domain_events` y como parámetro opcional `p_correlation_id DEFAULT NULL` en `commit_package_change`; el contrato de evento de DECOR-29 (`schemaVersion: 1`) no cambia, porque `correlationId` no es un campo del evento sino metadato de la fila de la outbox. `PackageController` lee `x-correlation-id` del request (o genera un UUID con `IdGenerator`), lo pasa a los casos de uso de paquete como parámetro opcional y responde con el mismo valor en el header, para que el cliente pueda correlacionar su petición con los logs del reintento y la reconciliación.

## Risks / Trade-offs

- [Dos operadores disparan reintentos al mismo tiempo] -> `claim_retry_domain_event` exige el `attempts` esperado; el segundo disparo no reclama nada para los eventos ya tomados por el primero.
- [El secreto de recuperación se filtra] -> Se compara con `timingSafeEqual` para evitar fugas por tiempo; la rotación del secreto es operativa (variable de entorno), fuera de este cambio.
- [`reconcile_budget` corrige un total que en realidad es correcto porque el paquete cambió entre el cálculo y la escritura] -> Se acepta: la reconciliación relee el paquete en el momento de ejecutarse: una corrección que queda obsoleta por un evento posterior se vuelve a corregir en la siguiente pasada, igual que cualquier resync eventual descrito en `docs/DecorAR.md` sección 2.4.

## Migration Plan

Migración aditiva. La reversión elimina `reconcile_budget`, `mark_domain_event_failed`, `list_retryable_domain_events` y `claim_retry_domain_event`, revierte el `CHECK` de `status` a `('pending','published')` (exige que no existan filas `failed`) y elimina la columna `correlation_id`, en ese orden.
