# Spec Delta

## Purpose

Permite entregar cotizaciones que conservan sus valores históricos, con número y versión, totales calculados en servidor y acceso exclusivo del propietario.

## ADDED Requirements

### Requirement: Cotización como instantánea inmutable
El sistema SHALL guardar cada cotización con sus líneas (nombre, cantidad y precio unitario), datos del cliente y del evento, vigencia, tasas, descuento, impuesto, anticipo, total y condiciones copiados en el momento de crearla. Modificar o eliminar el evento, o cambiar el catálogo, MUST NOT alterar una cotización guardada.

#### Scenario: Cambia el catálogo después de cotizar
- **WHEN** el precio o el nombre de un módulo cambia después de crear una cotización
- **THEN** la cotización conserva el nombre, el precio y los totales originales

#### Scenario: Se elimina el evento
- **WHEN** el propietario elimina el evento de origen
- **THEN** la cotización se conserva sin referencia al evento

#### Scenario: Intento de modificar valores guardados
- **WHEN** cualquier proceso intenta modificar montos, términos, datos congelados o líneas de una cotización
- **THEN** la base de datos rechaza el cambio

### Requirement: Totales calculados en servidor
El sistema SHALL calcular los totales en servidor a partir del evento y de las tasas indicadas, ignorando cualquier monto enviado por el cliente. Los montos SHALL ser pesos colombianos enteros con redondeo al peso, la mitad hacia arriba: descuento sobre el subtotal, impuesto sobre la base después del descuento y anticipo sobre el total.

#### Scenario: Cálculo con descuento, impuesto y anticipo
- **WHEN** se cotiza un evento con subtotal de 500.000 COP, 10 % de descuento, 19 % de impuesto y 50 % de anticipo
- **THEN** el descuento es 50.000, el impuesto 85.500, el total 535.500 y el anticipo 267.750

#### Scenario: Total enviado por el cliente
- **WHEN** la solicitud incluye un total o subtotal propio
- **THEN** el sistema lo ignora y guarda el calculado en servidor

### Requirement: Rechazo de valores inválidos
El sistema MUST rechazar una vigencia ausente, inválida o pasada, tasas fuera de 0 % a 100 % o no enteras en puntos básicos, textos que superen sus límites, eventos sin elementos y solicitudes cuya instantánea no coincida con el evento actual, sin crear datos parciales.

#### Scenario: Tasa fuera de rango
- **WHEN** el propietario indica un descuento negativo o un impuesto mayor a 100 %
- **THEN** el sistema responde un error identificable y no crea la cotización

#### Scenario: El evento cambió durante la operación
- **WHEN** el evento cambia entre la lectura y el guardado
- **THEN** el sistema responde un conflicto y no crea la cotización

### Requirement: Número y versiones independientes
Cada cotización nueva SHALL recibir el siguiente número del propietario y la versión 1. Crear una versión nueva SHALL conservar el número, asignar la siguiente versión, tomar otra vez el evento actual y MUST NOT modificar ninguna versión anterior.

#### Scenario: Nueva versión tras cambiar el evento
- **WHEN** el propietario agrega elementos al evento y crea una nueva versión de su cotización
- **THEN** la nueva versión tiene el mismo número, la versión siguiente y los valores actuales, y la versión anterior queda idéntica

#### Scenario: Numeración por propietario
- **WHEN** dos propietarios crean su primera cotización
- **THEN** ambos reciben el número 1 y ningún número se repite para un mismo propietario

### Requirement: Estados de la cotización
Cada versión SHALL nacer en borrador y SHALL admitir solo las transiciones borrador → enviada, borrador → vencida, enviada → aceptada y enviada → vencida. Aceptada y vencida SHALL ser estados finales.

#### Scenario: Transición inválida
- **WHEN** el propietario intenta aceptar un borrador o reabrir una cotización aceptada
- **THEN** el sistema rechaza el cambio y conserva el estado

### Requirement: Acceso exclusivo del propietario
La API SHALL exigir sesión y SHALL permitir crear, versionar, consultar, listar y cambiar el estado solo de las cotizaciones del propietario. Una cotización o un evento ajeno MUST responder igual que uno inexistente.

#### Scenario: Usuario sin sesión
- **WHEN** una solicitud sin sesión intenta usar la API de cotizaciones
- **THEN** el sistema responde 401

#### Scenario: Cotización de otro usuario
- **WHEN** un usuario consulta, versiona o cambia el estado de una cotización ajena
- **THEN** el sistema responde 404 y no revela ni modifica datos

#### Scenario: Escritura directa en la base de datos
- **WHEN** un cliente público o autenticado intenta escribir directamente en las tablas de cotizaciones
- **THEN** la base de datos rechaza la escritura
