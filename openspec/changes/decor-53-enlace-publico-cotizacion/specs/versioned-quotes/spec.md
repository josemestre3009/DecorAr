# Spec Delta

## MODIFIED Requirements

### Requirement: Acceso exclusivo del propietario
La API SHALL exigir sesión y SHALL permitir crear, versionar, consultar, listar, cambiar el estado y administrar el enlace público solo de las cotizaciones del propietario. Una cotización o un evento ajeno MUST responder igual que uno inexistente. La lectura pública de una cotización a través de un enlace válido (ver "Enlace público revocable") MUST NOT exigir sesión, y MUST NOT exponer ninguna otra operación sin sesión.

#### Scenario: Usuario sin sesión
- **WHEN** una solicitud sin sesión intenta usar la API autenticada de cotizaciones
- **THEN** el sistema responde 401

#### Scenario: Cotización de otro usuario
- **WHEN** un usuario consulta, versiona, cambia el estado o administra el enlace de una cotización ajena
- **THEN** el sistema responde 404 y no revela ni modifica datos

#### Scenario: Escritura directa en la base de datos
- **WHEN** un cliente público o autenticado intenta escribir directamente en las tablas de cotizaciones o de enlaces compartidos
- **THEN** la base de datos rechaza la escritura

## ADDED Requirements

### Requirement: Enlace público revocable
El sistema SHALL permitir al propietario crear, para una cotización en estado enviada o aceptada, un enlace público con un token no predecible, una vigencia que no exceda la fecha de vigencia de la cotización, y revocarlo en cualquier momento. El sistema SHALL mantener como máximo un enlace activo por cotización y SHALL devolver el enlace existente ante una creación repetida. El sistema SHALL revocar automáticamente el enlace de una versión cuando se crea una versión nueva de la misma cotización. El token MUST NOT guardarse en la base de datos ni aparecer en ningún registro; solo se guarda su huella.

#### Scenario: Crear enlace de una cotización enviada o aceptada
- **WHEN** el propietario crea un enlace para una cotización en estado "enviada" o "aceptada"
- **THEN** el sistema genera un token no predecible y devuelve la URL pública

#### Scenario: Intento de compartir un borrador o una cotización vencida
- **WHEN** el propietario intenta crear un enlace para una cotización en estado "borrador" o "vencida"
- **THEN** el sistema rechaza la operación sin crear ningún enlace

#### Scenario: Reintento no duplica el enlace
- **WHEN** el propietario repite la creación del enlace para la misma cotización mientras el enlace activo sigue vigente
- **THEN** el sistema devuelve el mismo enlace existente

#### Scenario: Nueva versión revoca el enlace anterior
- **WHEN** el propietario crea una versión nueva de una cotización que tenía un enlace activo
- **THEN** el enlace de la versión anterior queda revocado y deja de funcionar

#### Scenario: Revocación manual
- **WHEN** el propietario revoca el enlace activo
- **THEN** el enlace deja de funcionar de inmediato

### Requirement: Lectura pública mínima y uniforme ante error
El sistema SHALL permitir que cualquier visitante sin sesión consulte una cotización a través de un enlace vigente y no revocado, mostrando solo los datos del cliente, del evento, las líneas, los totales, las condiciones y la vigencia; MUST NOT exponer identificadores internos, el estado de la cotización, datos del propietario, el evento de origen, modelos 3D ni funciones de realidad aumentada. Un token con formato inválido, inexistente, vencido, revocado o de una cotización que ya no está enviada o aceptada SHALL producir la misma respuesta de no encontrado, sin distinguir el motivo.

#### Scenario: Cliente sin sesión abre un enlace vigente
- **WHEN** un visitante sin sesión abre la URL de un enlace activo y no vencido
- **THEN** ve la cotización compartida sin iniciar sesión y sin ver datos de otra cotización

#### Scenario: Enlace vencido
- **WHEN** un visitante abre un enlace cuya vigencia ya pasó
- **THEN** el sistema responde como si el enlace no existiera

#### Scenario: Enlace revocado
- **WHEN** un visitante abre un enlace que el propietario revocó
- **THEN** el sistema responde como si el enlace no existiera

#### Scenario: Token con formato inválido
- **WHEN** un visitante abre una URL con un token que no tiene el formato esperado
- **THEN** el sistema responde como si el enlace no existiera, sin consultar la base de datos
