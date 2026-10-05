# Spec Delta

## Purpose

Garantiza que productores, consumidores y frontend interpreten los eventos del MVP con una única definición versionada.

## ADDED Requirements

### Requirement: Sobre común de eventos
Cada evento del MVP SHALL incluir `eventId`, `type`, `schemaVersion`, `occurredAt`, `userId`, `packageId` y `payload`, donde `schemaVersion` MUST ser el número JSON `1` y `occurredAt` MUST ser una fecha ISO 8601 en UTC.

#### Scenario: Evento válido aceptado
- **WHEN** se valida un evento conocido con todos sus campos y `schemaVersion: 1`
- **THEN** la validación lo acepta y devuelve el evento tipado

#### Scenario: Origen identificable
- **WHEN** un consumidor recibe un evento aceptado
- **THEN** puede identificar el evento, el usuario, el paquete y el instante en que ocurrió

### Requirement: Eventos del MVP
El sistema SHALL definir los eventos `package.module.added` y `package.module.removed` con `itemId` y `moduleId`, y `budget.recalculated` con `budgetId`, `totalCop` entero no negativo y `causationEventId`. El sistema SHALL proporcionar un ejemplo válido de cada evento.

#### Scenario: Ejemplos válidos
- **WHEN** se valida el ejemplo publicado de cada tipo de evento
- **THEN** cada ejemplo es aceptado

#### Scenario: Tipo desconocido
- **WHEN** se valida un evento cuyo `type` no pertenece al contrato
- **THEN** la validación lo rechaza con un error que nombra el tipo recibido

### Requirement: Rechazo controlado
La validación en tiempo de ejecución MUST rechazar sin lanzar excepciones los eventos incompletos o con una versión distinta de `1`, devolviendo un error comprensible.

#### Scenario: Campo obligatorio faltante
- **WHEN** se valida un evento sin alguno de sus campos obligatorios
- **THEN** la validación lo rechaza con un error que nombra el campo

#### Scenario: Versión desconocida
- **WHEN** se valida un evento con `schemaVersion` distinto del número `1`
- **THEN** la validación lo rechaza con un error de versión no soportada

### Requirement: Canal privado por paquete
Los eventos de un paquete SHALL dirigirse al canal privado `package:{packageId}`.

#### Scenario: Nombre del canal
- **WHEN** se solicita el canal de un paquete
- **THEN** se obtiene `package:` seguido del identificador del paquete

### Requirement: Puerto de publicación
La capa de aplicación SHALL exponer un puerto `EventPublisher` que publique eventos del contrato sin depender de un adaptador concreto.

#### Scenario: Publicación mediante el puerto
- **WHEN** un caso de uso necesita publicar un evento del MVP
- **THEN** usa `EventPublisher` con un evento del contrato
