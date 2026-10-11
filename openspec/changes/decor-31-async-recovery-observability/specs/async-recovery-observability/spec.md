# Spec Delta

## Purpose

Garantiza que un fallo de publicación o de recálculo se recupere con un número acotado de reintentos, que lo que no se recupera quede identificable para reconciliación, que la reconciliación corrija sin duplicar, y que todo el proceso quede visible en logs sin filtrar secretos.

## ADDED Requirements

### Requirement: Reintentos acotados con backoff creciente
El sistema SHALL reintentar un evento `pending` con `attempts` entre 1 y 3 un máximo de tres veces, esperando 1, 2 y 4 segundos respectivamente antes de cada reintento. El sistema MUST NOT reintentar un evento indefinidamente.

#### Scenario: Fallo transitorio se recupera
- **WHEN** un evento falla en su intento inicial y la publicación tiene éxito en el primer reintento
- **THEN** el evento queda `published` y no se programan más reintentos

#### Scenario: Fallo permanente agota los reintentos
- **WHEN** un evento falla en el intento inicial y en los tres reintentos
- **THEN** el sistema realiza exactamente tres reintentos y ningún reintento adicional ocurre después del tercero

### Requirement: Estado final tras agotar los reintentos
El sistema SHALL marcar `failed` un evento que agotó sus tres reintentos sin publicarse, y MUST NOT reintentarlo de nuevo. El evento permanece disponible para reconciliación.

#### Scenario: Cuarto fallo marca failed
- **WHEN** el tercer reintento de un evento falla
- **THEN** el evento queda `failed` con su último error y no aparece más en la lista de reintentables

### Requirement: Reclamo de reintento seguro ante concurrencia
El sistema SHALL incrementar el contador de intentos de un evento solo si coincide con el intento esperado por quien lo reclama. Dos reclamos concurrentes del mismo evento y del mismo intento MUST NOT publicar el evento dos veces.

#### Scenario: Dos workers reintentan el mismo evento
- **WHEN** dos procesos intentan reclamar el mismo evento para el mismo número de intento
- **THEN** solo uno lo reclama y lo publica

### Requirement: Reconciliación de presupuesto idempotente
El sistema SHALL releer el paquete persistido, recalcular su presupuesto y corregir el valor almacenado solo si difiere del recalculado. Una segunda reconciliación con el mismo resultado MUST NOT modificar el presupuesto de nuevo.

#### Scenario: Corrección aplicada
- **WHEN** el presupuesto almacenado no coincide con el recalculado a partir del paquete persistido
- **THEN** el presupuesto se corrige y la operación se registra

#### Scenario: Reconciliación repetida sin cambios
- **WHEN** se reconcilia un paquete cuyo presupuesto ya coincide con el recalculado
- **THEN** el presupuesto no cambia y la operación se reporta sin corrección

### Requirement: Duplicado durante la recuperación no duplica el total
El sistema MUST NOT duplicar el total de un presupuesto cuando un evento ya aplicado se reintenta o se reconcilia después.

#### Scenario: Evento ya aplicado se reintenta
- **WHEN** un evento cuyo `eventId` ya fue procesado por el consumidor de presupuesto se reintenta o se incluye en una reconciliación
- **THEN** el presupuesto conserva el mismo total que antes del reintento o la reconciliación

### Requirement: Logs sanitizados
El sistema SHALL registrar cada intento, reintento, fallo y reconciliación como una línea estructurada con `timestamp`, `level`, `component`, `eventId`, `correlationId`, `packageId`, `attempt` y una descripción segura del error. El sistema MUST NOT incluir tokens, cookies, claves de servicio, contraseñas, el email completo de un usuario ni el payload crudo de un evento en ningún log.

#### Scenario: Contexto con datos sensibles
- **WHEN** el contexto de un log incluye un token, una cookie, una clave de servicio, una contraseña o un email completo
- **THEN** la línea registrada censura o enmascara esos valores y nunca los expone en texto plano

#### Scenario: Fallo con payload de evento
- **WHEN** se registra el fallo de un evento
- **THEN** el log incluye `eventId` y `packageId` pero no el cuerpo (`payload`) del evento

### Requirement: Endpoint protegido para operar la recuperación
El sistema SHALL exponer un endpoint que liste eventos pendientes y fallidos, dispare los reintentos y dispare la reconciliación, protegido por un secreto compartido independiente de la sesión de usuario. El sistema MUST rechazar una petición sin el secreto correcto y MUST responder sin aceptar ninguna petición si el secreto no está configurado en el servidor.

#### Scenario: Secreto correcto
- **WHEN** la petición incluye el encabezado `Authorization` con el secreto configurado
- **THEN** el endpoint ejecuta la acción solicitada

#### Scenario: Secreto ausente o incorrecto
- **WHEN** la petición no incluye el secreto o incluye uno distinto al configurado
- **THEN** el endpoint responde `401` sin ejecutar ninguna acción

#### Scenario: Secreto no configurado en el servidor
- **WHEN** la variable de entorno del secreto no está definida
- **THEN** el endpoint responde `503` para cualquier petición

### Requirement: Propagación de correlationId
El sistema SHALL propagar un `correlationId` desde la petición HTTP que origina un cambio de paquete hasta el registro del evento, sus reintentos y su reconciliación, sin modificar el contrato de evento versionado.

#### Scenario: Petición con correlationId explícito
- **WHEN** la petición HTTP incluye un `correlationId`
- **THEN** ese mismo valor aparece en el evento persistido y en los logs de sus reintentos

#### Scenario: Petición sin correlationId
- **WHEN** la petición HTTP no incluye un `correlationId`
- **THEN** el sistema genera uno y lo usa de forma consistente en el evento y sus logs
