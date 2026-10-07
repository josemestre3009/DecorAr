# Spec Delta

## Purpose

Garantiza que cada cambio de paquete y su evento se confirmen juntos y que el evento se publique después del commit, una sola vez por drenado inicial y sólo por Broadcast privado.

## ADDED Requirements

### Requirement: Cambio de paquete y evento atómicos
El sistema SHALL aplicar el cambio de paquete descrito por un evento `package.module.added` o `package.module.removed` e insertar ese evento en la outbox mediante una única función PostgreSQL. Si cualquier escritura falla, ninguna MUST persistir.

#### Scenario: Cambio confirmado
- **WHEN** se confirma un evento válido sobre un paquete del usuario
- **THEN** el elemento se agrega o elimina, la versión del paquete aumenta en uno y el evento queda `pending` en la outbox

#### Scenario: Fallo al insertar el evento
- **WHEN** la inserción del evento falla después de modificar el paquete
- **THEN** el elemento y la versión del paquete quedan como estaban

#### Scenario: Paquete ajeno o versión desactualizada
- **WHEN** el paquete no pertenece al `userId` del evento o su versión no coincide con la esperada
- **THEN** la operación se rechaza sin escribir en el paquete ni en la outbox

### Requirement: Identidad única del evento
La outbox MUST rechazar un segundo evento con el mismo `eventId`.

#### Scenario: eventId repetido
- **WHEN** se confirma un evento cuyo `eventId` ya existe
- **THEN** la operación se rechaza con `event.duplicate` y el cambio de paquete se revierte

### Requirement: Outbox privada
La outbox y sus funciones MUST NOT ser legibles, escribibles ni ejecutables por `anon` ni `authenticated`.

#### Scenario: Acceso desde el cliente
- **WHEN** `anon` o `authenticated` intenta leer o escribir la outbox o ejecutar sus funciones
- **THEN** PostgreSQL deniega el permiso

### Requirement: Drenado inicial concurrente seguro
El drainer SHALL reclamar sólo eventos `pending` sin intentos, con un bloqueo equivalente a `FOR UPDATE SKIP LOCKED`, y registrar el intento en la misma operación. Un evento reclamado MUST NOT ser reclamado otra vez por el drenado inicial.

#### Scenario: Dos drainers
- **WHEN** dos drainers drenan la misma outbox
- **THEN** cada evento se publica una sola vez

#### Scenario: Único intento inicial
- **WHEN** un evento ya tuvo su intento inicial
- **THEN** el drenado inicial no lo vuelve a reclamar y queda para el proceso de reintentos

### Requirement: Marcado tras éxito
El drainer SHALL marcar un evento `published` sólo después de que la publicación tenga éxito. Si falla, el evento MUST seguir `pending` con el intento y el error registrados.

#### Scenario: Publicación exitosa
- **WHEN** Realtime acepta el evento
- **THEN** el evento queda `published` con su fecha de publicación

#### Scenario: Publicación fallida
- **WHEN** Realtime rechaza el evento o no responde
- **THEN** el evento sigue `pending`, con un intento y el último error

### Requirement: Broadcast privado
Los eventos SHALL publicarse por Broadcast privado de Supabase Realtime en el canal `package:{packageId}`, con el tipo como nombre del mensaje y el evento completo como contenido, y MUST NOT depender de `postgres_changes`.

#### Scenario: Envío al canal del paquete
- **WHEN** el drainer publica un evento
- **THEN** lo envía al canal privado `package:{packageId}` con el nombre `type`

### Requirement: Paquetes desacoplado
El dominio y la aplicación de eventos y el módulo de paquetes MUST NOT importar Supabase ni el módulo de presupuesto.

#### Scenario: Dependencias de paquetes
- **WHEN** se analizan sus importaciones
- **THEN** no hay importaciones de `@supabase/*` ni de `src/modules/budget`
