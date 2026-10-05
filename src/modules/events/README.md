# Events

- `domain`: contratos versionados y trazabilidad.
- `application`: puertos de publicación y consumo.
- `infrastructure`: outbox, entrega y Realtime server-side.

Contrato del MVP (DECOR-29), `schemaVersion: 1`:

- `domain/event-contracts.ts`: tipos `package.module.added`, `package.module.removed` y `budget.recalculated`, `parseDomainEvent` y `packageChannel` (`package:{packageId}`).
- `domain/event-examples.ts`: un ejemplo válido de cada evento.
- `application/event-publisher.ts`: puerto `EventPublisher`.

Realtime no reemplaza persistencia durable.
