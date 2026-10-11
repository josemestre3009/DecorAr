# Spec Delta

## Purpose

Demuestra formalmente mediante una suite automatizada la atomicidad, seguridad, idempotencia y recuperación de eventos para el sistema DecorAR.

## ADDED Requirements

### Requirement: Atomicidad en mutaciones y eventos
El sistema SHALL garantizar que las mutaciones de paquete y registro de eventos outbox, así como el recálculo de presupuesto y registro de eventos procesados, ocurran de manera estrictamente atómica.

#### Scenario: Mutación de paquete y outbox atómicos
- **WHEN** se invoca `commit_package_change` con un evento válido
- **THEN** los elementos del paquete, la versión y la fila en `private.domain_events` se persisten conjuntamente; ante error de versión o propiedad, ninguna escritura persiste.

#### Scenario: Presupuesto y evento procesado atómicos
- **WHEN** se invoca `process_budget_event` con un nuevo evento
- **THEN** la fila en `private.processed_events` y la actualización en `public.budgets` se confirman conjuntamente.

### Requirement: Idempotencia y tolerancia al desorden
El sistema SHALL ser inmune a eventos duplicados, desordenados o de versión incompatible.

#### Scenario: Inserción de evento con eventId duplicado
- **WHEN** se somete un evento cuyo `eventId` ya existe en `private.domain_events`
- **THEN** la transacción aborta con excepción `event.duplicate` sin alterar el paquete.

#### Scenario: Consumo de evento duplicado
- **WHEN** se procesa un evento cuyo `eventId` ya existe en `private.processed_events`
- **THEN** la función retorna `applied = false` y el total del presupuesto permanece idéntico.

#### Scenario: Evento desordenado
- **WHEN** llega un evento con `packageVersion` menor o igual a la actual
- **THEN** se registra en `processed_events` pero no se sobrescribe el total del presupuesto.

### Requirement: Seguridad negativa y control de acceso
El sistema SHALL aplicar RLS y permisos restringidos en todos los niveles para usuarios A, B y anónimo.

#### Scenario: Aislamiento entre usuarios A y B
- **WHEN** el usuario B intenta consultar paquetes, elementos o presupuesto del usuario A
- **THEN** la consulta retorna 0 filas.

#### Scenario: Acceso de usuario anónimo
- **WHEN** un cliente no autenticado consulta `packages` o `budgets`
- **THEN** la base de datos deniega el acceso con código 42501.

#### Scenario: Acceso a esquemas y funciones privadas
- **WHEN** roles `anon` o `authenticated` intentan leer `private.domain_events` o ejecutar RPCs del sistema
- **THEN** la base de datos deniega el acceso.

#### Scenario: Canal Broadcast privado de Realtime
- **WHEN** el usuario B o un cliente anónimo intenta escuchar el canal `package:{packageId_A}`
- **THEN** la política de `realtime.messages` deniega el acceso.

### Requirement: Concurrencia de drainers y recuperación determinista
El sistema SHALL soportar múltiples drainers concurrentes y recuperar estados inconsistentes mediante reconciliación.

#### Scenario: Drenado concurrente sin duplicados
- **WHEN** dos drainers ejecutan reclamos concurrentes mediante `claim_initial_domain_events`
- **THEN** ningún evento es reclamado o publicado más de una vez.

#### Scenario: Reconciliación tras fallo
- **WHEN** un evento falla de manera permanente y el presupuesto queda desalineado
- **THEN** `reconcile_budget` detecta la discrepancia y ajusta el total al valor real del paquete sin duplicar montos.
