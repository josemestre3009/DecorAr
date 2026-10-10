# Design

## Context

DECOR-29 fijó el contrato de eventos y el puerto `EventPublisher`; DECOR-32 construyó la outbox `private.domain_events` y el drenado que publica por Broadcast privado; DECOR-30 fijó RLS, `checkPackageAccess` y la convención de que las tablas internas de Presupuesto viven en `private`, igual que la outbox. Ningún módulo de Presupuesto existe aún. Véase `proposal.md` para la motivación.

## Goals / Non-Goals

**Goals:**

- Presupuesto único dueño: solo este consumidor escribe `budgets`.
- Un mismo `eventId` procesado dos veces nunca duplica fila ni republica.
- Un evento con `packageVersion` vieja nunca sobrescribe un total más reciente.
- Un fallo entre calcular y persistir no deja `budgets`/`processed_events` a medias.
- Resync vía `GET /api/packages/{id}/budget` sin exponer `budgets` al navegador.

**Non-Goals:**

- Reintentos, backoff y reconciliación del lado de Presupuesto (DECOR-31 cubre outbox; este cambio no añade un segundo mecanismo).
- Logs estructurados u observabilidad agregada (DECOR-31).
- UI de presupuesto en vivo (Mei 4/6, DECOR-21).
- Cambiar la outbox, el drenado o el contrato de eventos ya fijados por DECOR-29/32.

## Decisions

### Composite de solo hojas, sin flag de "activo"

`calculateBudget` suma `priceCop` de cada fila de `package_items` existente (join con `catalog_modules` para el precio vigente); un grupo (`ComponenteDecorativo` compuesto, DECOR-25) no aporta un precio propio, solo agrega recursivamente el de sus hojas. No existe una columna de estado "activo" separada en `package_items`: la fila existe o fue borrada por `commit_package_change`, así que su existencia es la señal. `calculateBudget` es puro (sin Supabase) y vive en `domain`.

Alternativa descartada: marcar hojas con un flag `active`. DECOR-27/25 no definen tal columna; agregarla ahora adelantaría una decisión de un módulo que no es dueño de `package_items`.

### Idempotencia y no-regresión por `packageVersion`, no por `occurredAt`

`process_budget_event(p_consumer, p_event_id, p_package_id, p_package_version, p_total_cop)` inserta primero en `private.processed_events` con `UNIQUE (consumer, event_id)`. Si la inserción choca, la función devuelve `applied = false` sin tocar `budgets`: la replicación exacta de un evento ya visto no recalcula ni republica. Si la inserción tiene éxito, la función hace upsert en `budgets` **solo si** `p_package_version` es estrictamente mayor que `budgets.package_version` ya almacenado (o no hay fila). Un evento fuera de orden con versión vieja queda registrado en `processed_events` (para que no se reintente como si fuera nuevo) pero no mueve el total.

Alternativa descartada: comparar por `occurredAt`. El propio DECOR-21 distingue `packageVersion` (control de concurrencia del paquete) de `schemaVersion` (versión del contrato de evento); usar el reloj del evento no protege contra reordenamiento cuando dos productores compiten, mientras que `packageVersion` es monótona por construcción de `commit_package_change`.

### Cálculo en TypeScript, persistencia en una función atómica

El caso de uso `ConsumePackageChangedEvent` relee el paquete (`PackageSnapshotReader`), calcula con `calculateBudget` (dominio puro) y pasa el total ya calculado a `process_budget_event`. La función no recalcula nada: solo decide si aplica el resultado y lo persiste junto al `processed_event` en una transacción. Esto mantiene la regla de negocio (qué es una hoja, cómo se suma) en `application`/`domain`, no en SQL, igual que DECOR-27 valida capacidad en TypeScript y usa la RPC solo para la escritura atómica.

Alternativa descartada: calcular el total dentro de la función PostgreSQL. Duplicaría la regla de Composite en SQL y en TypeScript, y DECOR-25 seguiría cambiando esa regla en código.

### Esquema `private`, igual convención que la outbox

`private.processed_events` y `public.budgets` siguen el patrón de DECOR-32: `budgets` es pública porque el dueño necesita leerla por `GET`, pero sin acceso directo de `anon`/`authenticated` salvo lectura RLS por propiedad (mismo patrón que `packages`); `processed_events` es puramente interna y vive en `private` sin ningún grant a roles de cliente, exactamente como `domain_events`. La función es `SECURITY INVOKER`, `search_path=''`, objetos calificados, ejecutable solo por `service_role`.

Alternativa descartada: una sola tabla `budgets` con columna `processed_event_ids[]`. Rompe la unicidad declarativa por `(consumer, event_id)` y complica la concurrencia; la convención ya fijada por DECOR-30 reserva `processed_events` en `private` para este propósito.

### Disparo: mismo evento que consume el drenado, consumo del lado de Presupuesto

El drenado de DECOR-32 publica `package.module.added`/`removed` por Broadcast; ese Broadcast es para el cliente, no para Presupuesto. Presupuesto necesita consumir el evento de dominio, no el mensaje Realtime. Este cambio no modifica el drenado: añade `ConsumePackageChangedEvent`, invocado con el mismo evento ya persistido (parseado desde `private.domain_events` o pasado directamente por quien orqueste el flujo), de modo que persistir el presupuesto no depende de que Realtime haya entregado nada. La integración del disparo (p. ej. invocar el consumo justo después de `outbox.commit`, antes o junto al drenado) es una decisión de wiring de aplicación que no requiere tocar la tabla ni la RPC de outbox.

Alternativa descartada: que Presupuesto se suscriba al canal Broadcast `package:{packageId}` como consumidor server-side. Añadiría una dependencia de WebSocket/HTTP innecesaria cuando el evento ya está disponible en el mismo proceso que lo comitea; además el Broadcast es para el navegador (DECOR-30 solo autoriza al dueño a unirse).

### Publicación de `budget.recalculated` solo si `applied`

Tras `process_budget_event`, el caso de uso publica `budget.recalculated` (payload `{budgetId, totalCop, causationEventId}`, fijado por DECOR-29) mediante el mismo `EventPublisher`/`SupabaseBroadcastEventPublisher` de DECOR-32, y únicamente cuando la función reporta `applied = true`. Un duplicado o un evento viejo no genera una publicación redundante o regresiva.

### GET de resync con `checkPackageAccess`

`GET /api/packages/{id}/budget` llama `checkPackageAccess(authorizePackageAccess, packageId)` antes de cualquier lectura, igual que exige DECOR-30 para cualquier handler de paquete. Responde `{totalCop, currency:'COP', packageVersion, updatedAt}` con el cliente de sesión (RLS filtra además por dueño); 401/404 vienen de `checkPackageAccess`, 500 con el mismo envelope `{error:{code,message}}` que usan los demás handlers de paquete.

## Risks / Trade-offs

- [`budgets` sin fila antes del primer evento] -> El GET responde 404 `budget.not_found` hasta el primer `package.module.added`; Mei 4/6 (DECOR-21) define el estado inicial del lado de UI.
- [El disparo exacto del consumo todavía no tiene un único punto de entrada en producción, porque nadie invoca `outbox.commit` aún (DECOR-27 sigue en Backlog)] -> El caso de uso y sus puertos se prueban con dobles; la composición queda lista para que DECOR-27 la invoque junto al commit, sin inventar un contrato nuevo.
- [`PackageSnapshotReader` lee `package_items` sin que exista todavía el Composite completo de DECOR-25] -> El lector solo necesita `priceCop` por hoja y la versión del paquete, campos ya presentes en el esquema mínimo de DECOR-32; se amplía si DECOR-25 cambia la forma de agregación.

## Migration Plan

Migración aditiva. La reversión elimina `process_budget_event`, `public.budgets` y `private.processed_events`, en ese orden.
