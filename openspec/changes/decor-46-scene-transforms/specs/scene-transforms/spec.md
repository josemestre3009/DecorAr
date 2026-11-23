# Spec Delta

## Purpose

Permite guardar y recuperar la posición (x, y, z) y el giro horizontal de cada unidad de un paquete, de forma autorizada, versionada y atómica, sin afectar al presupuesto ni al Composite de zonas.

## ADDED Requirements

### Requirement: Guardar la posición de cada unidad repetida
El propietario SHALL poder guardar la posición y rotación horizontal de cada unidad de un módulo, incluso cuando ese módulo está repetido. El sistema MUST identificar cada unidad por su `itemId` propio y conservar una posición independiente por unidad.

#### Scenario: Guardar posiciones distintas para unidades repetidas
- **WHEN** el propietario guarda la escena con posiciones distintas para dos `itemId` del mismo módulo
- **THEN** el sistema conserva ambas posiciones por separado y las devuelve sin mezclarlas

### Requirement: Recuperar la distribución guardada
Cerrar y volver a abrir el montaje SHALL devolver exactamente la última escena guardada para ese paquete.

#### Scenario: Leer tras guardar
- **WHEN** se guarda una escena y después se solicita `GET /scene` para el mismo paquete
- **THEN** el sistema devuelve las mismas posiciones, rotaciones y la versión de escena resultante del guardado

#### Scenario: Paquete sin escena guardada
- **WHEN** se solicita `GET /scene` para un paquete que nunca guardó una escena
- **THEN** el sistema responde 200 con una lista vacía de transforms y versión de escena 0

### Requirement: Aislamiento por propietario
Un usuario MUST NOT poder leer ni modificar la escena de un paquete que no le pertenece.

#### Scenario: Lectura ajena
- **WHEN** un usuario autenticado solicita `GET /scene` de un paquete de otro usuario
- **THEN** el sistema responde 404 sin revelar si el paquete existe

#### Scenario: Escritura ajena
- **WHEN** un usuario autenticado intenta `PUT /scene` sobre un paquete de otro usuario
- **THEN** el sistema responde 404 y no persiste ningún cambio

#### Scenario: Usuario anónimo
- **WHEN** una solicitud sin sesión llama a `GET` o `PUT /scene`
- **THEN** el sistema responde 401 y no persiste ningún cambio

### Requirement: Guardar la escena no recalcula el presupuesto
Guardar una escena SHALL NOT modificar `packages.version` ni disparar el consumidor de presupuesto.

#### Scenario: Presupuesto inalterado tras mover objetos
- **WHEN** el propietario guarda una escena con posiciones nuevas para varios objetos
- **THEN** `packages.version` y el total del presupuesto permanecen exactamente iguales a como estaban antes de guardar

### Requirement: Límites numéricos y validación
El sistema MUST rechazar una escena cuyos valores numéricos excedan los límites definidos (x/z en [-50, 50] metros, y en [-1, 5] metros, rotación cualquier número finito que se normaliza a [0, 360) grados) o cuya unidad no pertenezca al paquete indicado.

#### Scenario: Posición fuera de límite
- **WHEN** se intenta guardar una posición con `x` fuera de [-50, 50]
- **THEN** el sistema responde 422 y no persiste ningún cambio de esa escena

#### Scenario: Unidad de otro paquete
- **WHEN** la escena incluye un `itemId` que pertenece a otro paquete
- **THEN** el sistema responde 404 `scene.item_not_found` y no persiste ningún cambio

#### Scenario: Rotación fuera de rango se normaliza
- **WHEN** se guarda una rotación de 405 grados
- **THEN** el sistema la guarda y la devuelve como 45 grados

### Requirement: Conflicto de versión de escena
Guardar SHALL exigir la versión de escena esperada. Si la escena cambió desde la última lectura, el sistema MUST rechazar el guardado sin aplicar ningún cambio parcial.

#### Scenario: Versión de escena obsoleta
- **WHEN** se guarda con `expectedSceneVersion` distinto de la versión actual de la escena
- **THEN** el sistema responde 409 `scene.version_conflict`, no persiste ningún cambio y devuelve la versión actual

### Requirement: Cascada al eliminar una unidad
Si una unidad del paquete se elimina, su posición guardada MUST eliminarse junto con ella, sin dejar filas huérfanas.

#### Scenario: Eliminar unidad con posición guardada
- **WHEN** se elimina del paquete una unidad que tenía una posición guardada
- **THEN** la fila de posición de esa unidad desaparece y el resto de la escena permanece sin cambios
