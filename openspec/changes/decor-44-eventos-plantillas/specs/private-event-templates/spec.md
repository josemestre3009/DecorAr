# Spec Delta

## Purpose

Permite reutilizar configuraciones decorativas mediante plantillas privadas que producen eventos nuevos e independientes sin exponer datos específicos de clientes.

## ADDED Requirements

### Requirement: Guardar evento como plantilla privada
El propietario de un evento SHALL poder guardarlo como una plantilla privada con un nombre válido. La operación SHALL copiar módulos, cantidades, zonas, jerarquía y preferencias decorativas, y MUST excluir cliente, fecha y lugar.

#### Scenario: Guardar configuración completa
- **WHEN** el propietario guarda como plantilla un evento con módulos, cantidades, zonas y preferencias
- **THEN** el sistema crea una plantilla privada con una copia completa de esa configuración y deja el evento sin cambios

#### Scenario: Excluir datos específicos
- **WHEN** un evento con cliente, fecha y lugar se guarda como plantilla
- **THEN** la plantilla no contiene cliente, fecha ni lugar

#### Scenario: Nombre de plantilla inválido
- **WHEN** el propietario proporciona un nombre vacío, compuesto solo por espacios o mayor de 120 caracteres
- **THEN** el sistema rechaza la operación sin crear datos parciales

### Requirement: Crear evento desde plantilla
El propietario de una plantilla SHALL poder crear desde ella un evento indicando un nombre válido. El nuevo evento SHALL copiar módulos, cantidades, zonas, jerarquía y preferencias; cliente, fecha y lugar SHALL comenzar ausentes.

#### Scenario: Usar plantilla propia
- **WHEN** el propietario indica un nombre válido y usa una de sus plantillas
- **THEN** el sistema crea un evento con la configuración copiada y permite abrir su configurador

#### Scenario: Evento nuevo sin datos de cliente
- **WHEN** se crea un evento desde una plantilla
- **THEN** cliente, fecha y lugar están ausentes aunque el evento fuente de la plantilla los tuviera

### Requirement: Copia profunda independiente y atómica
Cada copia entre evento y plantilla SHALL asignar identificadores nuevos al agregado, zonas y elementos mutables, conservando referencias inmutables del catálogo. Cada operación SHALL confirmar todos sus cambios o ninguno; modificar o eliminar un origen después de copiar MUST NOT modificar ni eliminar el destino.

#### Scenario: Identificadores independientes
- **WHEN** se completa una copia entre evento y plantilla
- **THEN** el origen y el destino no comparten identificadores de agregado, zonas ni elementos mutables

#### Scenario: Modificar una copia
- **WHEN** el propietario modifica módulos, zonas, preferencias o metadatos de un evento creado desde plantilla
- **THEN** la plantilla conserva exactamente su configuración anterior

#### Scenario: Eliminar plantilla usada
- **WHEN** el propietario elimina una plantilla que ya produjo eventos
- **THEN** los eventos creados permanecen disponibles y sin cambios

#### Scenario: Fallo durante la copia
- **WHEN** cualquier escritura de una copia falla antes de completarse
- **THEN** el sistema revierte el agregado y todos sus registros dependientes sin dejar datos parciales

### Requirement: Operaciones privadas del propietario
Solo el propietario SHALL poder listar, consultar, usar, renombrar o eliminar una plantilla. Las decisiones de propiedad MUST aplicarse en la frontera HTTP y en persistencia; una plantilla ajena o inexistente MUST responder como no encontrada.

#### Scenario: Propietario gestiona plantilla
- **WHEN** el propietario lista, consulta, usa, renombra o elimina su plantilla
- **THEN** el sistema ejecuta la operación solicitada

#### Scenario: Otro decorador intenta acceder
- **WHEN** otro decorador intenta listar, consultar, usar, renombrar o eliminar la plantilla
- **THEN** el sistema no concede acceso ni revela que la plantilla existe

#### Scenario: Usuario anónimo intenta acceder
- **WHEN** un usuario sin sesión intenta operar sobre plantillas
- **THEN** el sistema rechaza la solicitud como no autenticada

### Requirement: Gestión accesible de plantillas
La interfaz SHALL ofrecer acciones de guardar, usar, renombrar y eliminar plantillas mediante teclado, foco visible, etiquetas accesibles, errores junto al campo correspondiente y anuncios de resultado para tecnologías de asistencia.

#### Scenario: Error de nombre accesible
- **WHEN** el decorador envía un nombre de plantilla inválido usando teclado
- **THEN** el foco permanece en un flujo recuperable y el error se asocia y anuncia junto al campo

#### Scenario: Confirmación de operación
- **WHEN** una operación de plantilla termina correctamente
- **THEN** la interfaz anuncia el resultado y refleja el nuevo estado sin requerir recarga manual
