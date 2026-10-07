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
- `public.commit_package_change(p_event, p_expected_version)`: aplica el cambio de un `package.module.added/removed`, incrementa la versión del paquete e inserta el evento en una transacción. Devuelve el nuevo `packageVersion`.
- `application/outbox.ts`: puertos `PackageChangeOutbox` (contrato con DECOR-27) y `OutboxStore`.
- `application/drain-outbox.use-case.ts`: intento inicial. Reclama con `FOR UPDATE SKIP LOCKED`, publica y marca `published` sólo tras éxito; si falla, el evento queda `pending` con `attempts = 1` y `last_error`.
- `infrastructure/`: adaptador RPC y publicador por Broadcast privado `package:{packageId}` (REST, sin `postgres_changes`).
- `createEventOutboxDependencies()` en `src/composition/server.ts` usa el cliente service-role: el Route Handler valida la sesión antes y pone el usuario de la sesión en el evento.

Los reintentos y la reconciliación son de DECOR-31. La entrega es al menos una vez: los consumidores deduplican por `eventId`.

Realtime no reemplaza persistencia durable.
