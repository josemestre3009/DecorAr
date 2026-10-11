# Events

- `domain`: contratos versionados y trazabilidad.
- `application`: puertos de publicación y consumo.
- `infrastructure`: outbox, entrega y Realtime server-side.

Contrato del MVP (DECOR-29), `schemaVersion: 1`:

- `domain/event-contracts.ts`: tipos `package.module.added`, `package.module.removed` y `budget.recalculated`, `parseDomainEvent` y `packageChannel` (`package:{packageId}`).
- `domain/event-examples.ts`: un ejemplo válido de cada evento.
- `application/event-publisher.ts`: puerto `EventPublisher`.

Outbox (DECOR-32), migración `supabase/migrations/20261007000000_create_event_outbox.sql`:

- `private.domain_events`: outbox fuera de la Data API, única por `eventId`, sin acceso para `anon` ni `authenticated`.
- `public.commit_package_change(p_event, p_expected_version, p_correlation_id)`: aplica el cambio de un `package.module.added/removed`, incrementa la versión del paquete e inserta el evento (con su `correlationId`, DECOR-31) en una transacción. Devuelve el nuevo `packageVersion`.
- `application/outbox.ts`: puertos `PackageChangeOutbox` (contrato con DECOR-27) y `OutboxStore`.
- `application/drain-outbox.use-case.ts`: intento inicial. Reclama con `FOR UPDATE SKIP LOCKED`, publica y marca `published` sólo tras éxito; si falla, el evento queda `pending` con `attempts = 1` y `last_error`.
- `infrastructure/`: adaptador RPC y publicador por Broadcast privado `package:{packageId}` (REST, sin `postgres_changes`).
- `createEventOutboxDependencies()` en `src/composition/server.ts` usa el cliente service-role: el Route Handler valida la sesión antes y pone el usuario de la sesión en el evento.

Reintentos y reconciliación (DECOR-31), migración `supabase/migrations/20261011000001_async_recovery.sql`:

- `private.domain_events` gana la columna `correlation_id` (nullable, metadato de fila, no parte del contrato de evento) y el estado `failed` junto a `pending`/`published`.
- `application/retry-outbox.use-case.ts` (`RetryOutboxUseCase`): toma eventos `pending` con 1 a 3 intentos previos, espera 1/2/4s (puerto `Sleep` inyectado) y reclama con `claim_retry_domain_event`, que sólo avanza `attempts` si coincide con el esperado (dos reintentos concurrentes del mismo evento nunca publican dos veces). Tras el tercer reintento fallido, `mark_domain_event_failed` deja el evento en `failed`: nunca un cuarto reintento.
- `OutboxStore` gana `listRetryable`, `claimRetry`, `markFailed` y `listUnresolved` (visibilidad para el endpoint de recuperación).
- `createRecoveryController()` en `src/composition/server.ts` expone `GET/POST /api/internal/recovery` (`src/interfaces/recovery`), protegido por un secreto Bearer (`DECOR_RECOVERY_SECRET`) en vez de sesión de usuario, porque no hay rol admin en la aplicación.
- Cada intento, reintento y fallo se registra con `createJsonLogger` (`src/infrastructure/logging`), que sanitiza el contexto (`src/shared/application/sanitize-log-context.ts`): nunca token, cookie, clave, contraseña, email completo ni payload crudo.
- `correlationId`: `PackageController` lee `x-correlation-id` del request o genera uno, lo pasa a `AddModuleToPackageUseCase`/`RemoveModuleFromPackageUseCase` y de ahí a `outbox.commit`; se devuelve en el header de la respuesta y queda disponible en los logs del reintento.

La entrega es al menos una vez: los consumidores deduplican por `eventId`.

Realtime no reemplaza persistencia durable.
