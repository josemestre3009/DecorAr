# Spec Delta

## Purpose

Garantiza que el presupuesto de un paquete se calcule a partir de sus hojas activas, se persista exactamente una vez por evento, nunca retroceda ante un evento desordenado, y pueda resincronizarse por API sin exponer su tabla al navegador.

## ADDED Requirements

### Requirement: Cálculo por Composite de solo hojas
El sistema SHALL calcular el presupuesto de un paquete como la suma del `priceCop` vigente de cada hoja (`package_items`) existente en el paquete. Un grupo compuesto MUST NOT aportar un monto propio además del de sus hojas.

#### Scenario: Paquete con hojas simples
- **WHEN** se calcula el presupuesto de un paquete con varias hojas y ningún grupo
- **THEN** el total es la suma de sus `priceCop`

#### Scenario: Paquete con un grupo anidado
- **WHEN** el paquete contiene un grupo compuesto por hojas
- **THEN** el total incluye el `priceCop` de cada hoja del grupo y no un monto adicional por el grupo

#### Scenario: Paquete vacío
- **WHEN** el paquete no tiene hojas
- **THEN** el total es cero

### Requirement: Persistencia atómica e idempotente por eventId
El sistema SHALL registrar el `eventId` procesado y, si corresponde, actualizar el presupuesto en una única función PostgreSQL. Un fallo en cualquiera de las dos escrituras MUST NOT dejar la otra persistida.

#### Scenario: Primer evento válido
- **WHEN** se procesa un evento con un `eventId` nunca visto y una `packageVersion` mayor que la almacenada
- **THEN** el presupuesto se actualiza y el evento queda registrado como procesado

#### Scenario: eventId repetido
- **WHEN** se procesa un evento cuyo `eventId` ya fue registrado para este consumidor
- **THEN** el presupuesto no cambia y no se publica un nuevo `budget.recalculated`

#### Scenario: Fallo de persistencia
- **WHEN** la escritura del presupuesto o del evento procesado falla dentro de la función
- **THEN** ninguna de las dos escrituras queda confirmada

### Requirement: No regresión por versión de paquete
El sistema MUST NOT sobrescribir un presupuesto con uno calculado a partir de una `packageVersion` igual o menor que la ya almacenada.

#### Scenario: Evento desordenado
- **WHEN** llega un evento cuya `packageVersion` es menor o igual que la del presupuesto ya guardado
- **THEN** el presupuesto almacenado no cambia, aunque el evento se registre como procesado

### Requirement: Tablas internas inaccesibles al cliente
`private.processed_events` MUST NOT ser legible, escribible ni ejecutable por `anon` ni `authenticated`. `public.budgets` SHALL permitir lectura únicamente al dueño del paquete; ninguna escritura directa es posible fuera de `process_budget_event`.

#### Scenario: Acceso directo desde el cliente
- **WHEN** `anon` o `authenticated` intenta leer o escribir `private.processed_events`, o escribir `public.budgets`, o ejecutar `process_budget_event`
- **THEN** PostgreSQL deniega el permiso

#### Scenario: Lectura del dueño
- **WHEN** el dueño autenticado lee su propio presupuesto
- **THEN** RLS permite la fila

### Requirement: Resync vía Route Handler
El sistema SHALL exponer `GET /api/packages/{id}/budget`, protegido por la misma autorización de propiedad que el resto de endpoints de paquete, que responde `{totalCop, currency:'COP', packageVersion, updatedAt}`.

#### Scenario: Dueño con presupuesto existente
- **WHEN** el dueño autenticado solicita el presupuesto de su paquete
- **THEN** la respuesta es 200 con el total, la moneda, la versión del paquete y la fecha de actualización

#### Scenario: Ajeno o anónimo
- **WHEN** un usuario ajeno o anónimo solicita el presupuesto de un paquete que no le pertenece
- **THEN** la respuesta es 404 o 401 según corresponda, sin revelar si el paquete existe

#### Scenario: Paquete sin presupuesto calculado
- **WHEN** el dueño solicita el presupuesto de un paquete que nunca tuvo un evento procesado
- **THEN** la respuesta es 404 con el envelope `{error:{code,message}}`

### Requirement: Publicación condicionada a un cambio real
El sistema SHALL publicar `budget.recalculated` por Broadcast privado únicamente cuando la función de persistencia aplicó un cambio real al presupuesto.

#### Scenario: Evento aplicado
- **WHEN** el evento procesado actualiza el presupuesto
- **THEN** se publica `budget.recalculated` en el canal `package:{packageId}`

#### Scenario: Evento duplicado o desordenado
- **WHEN** el evento procesado no cambia el presupuesto almacenado
- **THEN** no se publica ningún evento
