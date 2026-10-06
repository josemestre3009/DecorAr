# Proposal

## Why

Paquetes, Presupuesto y el cliente necesitan interpretar los mismos eventos antes de que se implementen la publicación, el consumo y Realtime. Sin un contrato único y versionado, cada colaborador inventaría su propio formato y las integraciones posteriores divergirían.

## What Changes

- Definir el sobre común de eventos con `eventId`, `type`, `schemaVersion`, `occurredAt`, `userId` y `packageId`.
- Definir los eventos `package.module.added`, `package.module.removed` y `budget.recalculated` con `schemaVersion: 1` numérico.
- Añadir validación en tiempo de ejecución que rechaza campos faltantes, tipos desconocidos y versiones distintas de `1` con errores comprensibles.
- Definir el nombre del canal privado `package:{packageId}`.
- Añadir el puerto `EventPublisher` para la publicación posterior.
- Proporcionar un ejemplo válido de cada evento.

## Capabilities

### New Capabilities

- `event-contracts`: Contrato versionado de eventos del MVP, validación en tiempo de ejecución, canal privado por paquete y puerto de publicación.

### Modified Capabilities

Ninguna.

## Impact

- Añade `src/modules/events/domain` y `src/modules/events/application` con pruebas unitarias.
- Actualiza la documentación local del módulo de eventos.
- No publica ni consume eventos, no añade outbox, SQL, RLS, Realtime, UI, endpoints ni dependencias npm.
