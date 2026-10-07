# Proposal

## Why

Paquetes debe confirmar cada cambio en PostgreSQL antes de anunciarlo, y el anuncio no puede perderse si Realtime falla. Sin una outbox escrita en la misma transacción que el paquete, un fallo entre el commit y la publicación deja al presupuesto sin enterarse, y encadenar peticiones desde Node no es una transacción.

## What Changes

- Crear la tabla `private.domain_events` (outbox) con `eventId` único, estado `pending`/`published`, intentos y último error, sin acceso para `anon` ni `authenticated`.
- Crear las tablas base `public.packages` y `public.package_items`, que la RPC necesita y que DECOR-27 ampliará.
- Crear la RPC atómica `public.commit_package_change(p_event, p_expected_version)` que aplica el cambio descrito por un evento `package.module.added` o `package.module.removed` y lo inserta en la outbox.
- Crear las RPC del drainer: `claim_initial_domain_events` con `FOR UPDATE SKIP LOCKED`, `mark_domain_event_published` y `record_domain_event_failure`.
- Añadir los puertos `PackageChangeOutbox` y `OutboxStore`, el caso de uso `DrainOutboxUseCase` y los adaptadores Supabase, incluido el publicador por Broadcast privado.
- Exponer la construcción server-only en `src/composition/server.ts`.

## Capabilities

### New Capabilities

- `event-outbox`: Persistencia atómica del cambio de paquete y su evento, drenado concurrente seguro con un único intento inicial y publicación por Broadcast privado.

### Modified Capabilities

Ninguna.

## Impact

- Añade una migración SQL y su prueba de contrato.
- Añade código en `src/modules/events/application` y `src/modules/events/infrastructure` con pruebas.
- Amplía `src/composition/server.ts` sin cambiar lo existente.
- No añade endpoints, UI, reintentos, políticas RLS por usuario ni dependencias npm.
