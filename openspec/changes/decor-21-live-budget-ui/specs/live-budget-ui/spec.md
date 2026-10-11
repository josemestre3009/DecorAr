# Spec Delta

## Purpose

Recepción de presupuesto confirmado por Broadcast privado y resincronización por API en el configurador de paquetes (`/packages/{id}`).

## ADDED Requirements

### Requirement: Recepción reactiva por Broadcast privado

El sistema SHALL suscribirse al canal privado `package:{packageId}` únicamente mediante `subscribeToPackageChannel`, sin utilizar `postgres_changes` ni realizar llamadas CRUD directas a la tabla `budgets`.

#### Scenario: Evento budget.recalculated actualiza el total

- **GIVEN** un paquete abierto en el configurador con presupuesto inicial
- **WHEN** llega el evento `budget.recalculated` por Broadcast privado
- **THEN** la UI actualiza el total confirmado al monto `totalCop` recibido y cancela el estado de recálculo

### Requirement: Deduplicación y control de versiones

El sistema SHALL descartar eventos duplicados con el mismo `eventId` y descartar respuestas de resincronización con `packageVersion` menor que la versión actualmente confirmada.

#### Scenario: Evento duplicado no se procesa dos veces

- **GIVEN** un evento `budget.recalculated` ya procesado
- **WHEN** llega un segundo evento con el mismo `eventId`
- **THEN** la UI ignora el segundo evento y no altera el estado

#### Scenario: Respuesta de resincronización obsoleta no causa regresión

- **GIVEN** un cliente con presupuesto confirmado para la versión 4
- **WHEN** una respuesta de resincronización retorna versión 2
- **THEN** la UI conserva el presupuesto de versión 4 sin sobrescribirlo

### Requirement: Indicador de actualización no bloqueante

El sistema SHALL mostrar un estado de "Actualizando presupuesto…" ante indicios de cambio en el paquete sin bloquear la interacción con el catálogo ni con las acciones de configuración.

#### Scenario: Cambios en el paquete activan estado de actualización

- **GIVEN** el configurador en pantalla
- **WHEN** llega un evento `package.module.added` o `package.module.removed` por el canal
- **THEN** la UI muestra la indicación de recálculo mientras espera el total confirmado

### Requirement: Resincronización automática

El sistema SHALL invocar `GET /api/packages/{packageId}/budget` ante reconexión de WebSocket, evento `online`, evento `visibilitychange` o detección de hueco de versión.

#### Scenario: Reconexión tras caída

- **GIVEN** una conexión Realtime que pasó por estado `closed` o `denied`
- **WHEN** la conexión transiciona nuevamente a `subscribed`
- **THEN** el cliente consulta automáticamente `GET /api/packages/{packageId}/budget` y reconcilia el total

#### Scenario: Regreso a la pestaña activa

- **GIVEN** la pestaña del navegador en segundo plano
- **WHEN** el usuario regresa y `document.visibilityState` pasa a `visible`
- **THEN** el cliente consulta `GET /api/packages/{packageId}/budget` para obtener el presupuesto más reciente

### Requirement: Retención del último confirmado ante fallo

El sistema SHALL conservar visible el último total confirmado si la resincronización o la conexión fallan, desplegando un aviso no intrusivo y permitiendo el reintento manual.

#### Scenario: Error de red o servidor no borra el valor actual

- **GIVEN** un presupuesto confirmado visible en pantalla
- **WHEN** la resincronización falla por error de red o HTTP 500
- **THEN** el monto confirmado continúa visible, se muestra un mensaje de alerta accesible y el botón de reintento queda habilitado
