# Design

## Context

DECOR-29 fijó el contrato de eventos, el canal `package:{packageId}` y el puerto `EventPublisher`. DECOR-27 construirá el Builder y los endpoints de paquete, y debe consumir una RPC atómica que DECOR-32 posee. DECOR-31 se encarga de los reintentos y DECOR-30 de RLS y canales privados. Véase `proposal.md` para la motivación.

## Goals / Non-Goals

**Goals:**

- Cambio de paquete y evento en una única transacción PostgreSQL.
- Outbox inaccesible para `anon` y `authenticated`.
- Drenado concurrente sin doble publicación y con un solo intento inicial.
- Publicación por Broadcast privado, nunca `postgres_changes`.

**Non-Goals:**

- Reintentos, backoff, logs estructurados y reconciliación (DECOR-31).
- Políticas RLS por usuario y autorización de canales (DECOR-30).
- Builder, capacidad, endpoints y creación de paquetes (DECOR-27).
- Consumo de eventos y presupuesto (DECOR-33).

## Decisions

### Outbox en el schema `private`

`private.domain_events` vive fuera de los schemas expuestos por PostgREST. Se revocan schema y tabla a `PUBLIC`, `anon` y `authenticated`; sólo `service_role` tiene uso. RLS se habilita igualmente como segunda barrera.

Alternativa descartada: tabla en `public` sin grants. Supabase concede privilegios por defecto en `public` y un olvido la expondría por la Data API.

### Contrato de la RPC con DECOR-27

`public.commit_package_change(p_event jsonb, p_expected_version integer DEFAULT NULL) RETURNS integer`:

- `p_event` es un evento `package.module.added` o `package.module.removed` ya validado con `parseDomainEvent`; el evento describe el cambio y se guarda tal cual en la outbox.
- Incrementa `packages.version` del paquete cuyo `user_id` coincide con `userId`, inserta o borra el `package_items` indicado e inserta el evento. Devuelve la nueva versión, que es el `packageVersion` de la respuesta HTTP.
- `p_expected_version` permite al Builder validar la capacidad en TypeScript sobre una versión leída y rechazar la escritura si otra petición cambió el paquete (`package.version_conflict`).
- Errores: `package.not_found`, `package.item_not_found`, `package.version_conflict`, `event.unsupported_type`, `event.unsupported_version`, `event.invalid`; un `eventId` repetido viola la unicidad y revierte todo (`event.duplicate`).

Se crean `public.packages` y `public.package_items` mínimos porque la RPC los necesita y aún no existen. DECOR-27 los amplía con migraciones aditivas.

### `SECURITY INVOKER` ejecutada por `service_role`

Todas las funciones son `SECURITY INVOKER`, con `search_path = ''` y nombres calificados. `EXECUTE` se revoca a `PUBLIC`, `anon` y `authenticated` y se concede sólo a `service_role`. El Route Handler valida la sesión y pasa el `userId` de la sesión en el evento; la RPC vuelve a exigir que el paquete pertenezca a ese usuario.

Alternativa descartada: invocar con la sesión del usuario. Exigiría conceder a `authenticated` escritura en la outbox, o `SECURITY DEFINER`, que la documentación reserva para casos imprescindibles.

### Reclamo con `FOR UPDATE SKIP LOCKED` y arrendamiento por intento

`claim_initial_domain_events(p_limit)` selecciona eventos `pending` con `attempts = 0` usando `FOR UPDATE SKIP LOCKED` y, en la misma sentencia, incrementa `attempts`. Dos drainers simultáneos se saltan las filas bloqueadas, y un drainer posterior ya no ve los eventos reclamados aunque el bloqueo se haya liberado. Así la publicación HTTP ocurre fuera de la transacción sin abrir una ventana de doble publicación.

Un evento reclamado cuyo proceso muere antes de marcarse queda `pending` con `attempts = 1`: lo recupera DECOR-31, que es dueño de los intentos posteriores.

### Estados y columnas

`status` es `pending` o `published`; `published_at` se fija sólo al marcar éxito. `attempts`, `last_attempt_at` y `last_error` dan a DECOR-31 lo necesario para reintentar con 1, 2 y 4 segundos.

### Publicación por Broadcast privado vía REST

`SupabaseBroadcastEventPublisher` crea el canal `package:{packageId}` con `private: true`, envía con `httpSend(event.type, event)` y elimina el canal. No necesita mantener un WebSocket en el servidor.

### Disparo del drainer

La composición expone `createEventOutboxDependencies()`. DECOR-27 invoca `commit` y, tras responder, ejecuta `drainOutbox.execute()` con `after()` de Next.js, de modo que la latencia de Realtime no bloquea la respuesta. DECOR-31 añade el job periódico.

### Entrega al menos una vez

Si Realtime acepta el mensaje pero falla el marcado, el evento queda `pending` y DECOR-31 lo volverá a publicar. Los consumidores deduplican por `eventId` (DECOR-33).

## Risks / Trade-offs

- [`service_role` omite RLS en la escritura] -> La RPC exige la propiedad del paquete y el Route Handler valida la sesión antes.
- [Las tablas de paquetes pueden quedarse cortas para DECOR-27] -> Son mínimas y se amplían de forma aditiva.
- [Las pruebas del repositorio no ejecutan PostgreSQL] -> La migración se verificó en PostgreSQL embebido fuera del repositorio; la concurrencia real entre conexiones queda para DECOR-34.

## Migration Plan

Migración aditiva. La reversión elimina las funciones, `private.domain_events`, `public.package_items` y `public.packages`, en ese orden.
