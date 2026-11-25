# Spec Delta

## MODIFIED Requirements

### Requirement: Acceso exclusivo del propietario
La API SHALL exigir sesión y SHALL permitir crear, versionar, consultar, listar, cambiar el estado y administrar el enlace público solo de las cotizaciones del propietario. Una cotización o un evento ajeno MUST responder igual que uno inexistente. Las claves de idempotencia SHALL ser por propietario: la clave de otro usuario MUST NOT devolver ni revelar su cotización.

#### Scenario: Cotización de otro usuario
- **WHEN** un usuario consulta, versiona, cambia el estado o administra el enlace de una cotización ajena
- **THEN** el sistema responde 404 y no revela ni modifica datos

#### Scenario: Clave de idempotencia de otro usuario
- **WHEN** un usuario crea una cotización con la misma `Idempotency-Key` que usó otro usuario
- **THEN** el sistema crea una cotización nueva del usuario y no devuelve la del otro

## ADDED Requirements

### Requirement: Creación idempotente
Crear una cotización o una versión SHALL exigir la cabecera `Idempotency-Key` (UUID). Un reintento con la misma clave y la misma solicitud SHALL devolver la cotización ya creada, sin asignar otro número ni otra versión. La misma clave con una solicitud distinta MUST rechazarse sin crear nada. El registro MUST guardar sólo la huella de la solicitud, no la solicitud.

#### Scenario: Reintento tras perder la respuesta
- **WHEN** el cliente repite la creación con la misma clave y los mismos datos
- **THEN** el sistema responde 201 con la misma cotización y `Idempotent-Replayed: true`, y existe una sola cotización

#### Scenario: Clave reutilizada con otros datos
- **WHEN** el cliente envía una clave ya usada con otros términos u otra operación
- **THEN** el sistema responde 422 `idempotency.key_reused` y no crea nada

#### Scenario: Clave ausente o inválida
- **WHEN** la creación llega sin `Idempotency-Key` o con un valor que no es UUID
- **THEN** el sistema responde 400 `idempotency.key_invalid`

### Requirement: Concurrencia optimista de versiones y estados
Crear una versión SHALL exigir `expectedVersion` y cambiar el estado SHALL exigir `expectedStatus`. Si la cotización cambió desde que el usuario la vio, el sistema MUST rechazar la operación sin escribir y SHALL devolver el valor actual. Repetir un cambio de estado que ya ocurrió SHALL responder con éxito sin volver a aplicarlo.

#### Scenario: Versión obsoleta
- **WHEN** el usuario crea una versión con `expectedVersion` menor que la última versión del número
- **THEN** el sistema responde 409 `quote.version_conflict` con `currentVersion` y no crea la versión

#### Scenario: Estado cambiado por otra pestaña
- **WHEN** el usuario cambia el estado con un `expectedStatus` que ya no es el actual
- **THEN** el sistema responde 409 `quote.status_conflict` con `currentStatus` y conserva el estado

#### Scenario: Reintento de un cambio de estado
- **WHEN** el usuario repite "marcar como enviada" sobre una cotización que ya está enviada
- **THEN** el sistema responde 200 con la cotización sin cambiarla

### Requirement: Logs sin datos sensibles
Los controladores y rutas de cotizaciones, enlaces públicos y escena SHALL registrar sólo con el `Logger` sanitizado e incluir el `correlationId`. Los registros MUST NOT contener el token del enlace, la URL pública, cookies de sesión ni el detalle crudo de errores de base de datos.

#### Scenario: Error interno al crear
- **WHEN** la base de datos falla al crear una cotización
- **THEN** el log contiene el código de dominio, el SQLSTATE y el `correlationId`, pero no los valores de la fila

#### Scenario: Error que menciona el token
- **WHEN** una operación del enlace falla con un mensaje que incluye el token o un JWT
- **THEN** ninguna línea de log contiene el token
