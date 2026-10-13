# Spec Delta

## Purpose

Permite organizar los módulos de un evento mediante zonas jerárquicas editables, con operaciones accesibles, autorizadas, versionadas y atómicas que conservan presupuesto, outbox y plantillas privadas.

## ADDED Requirements

### Requirement: Crear zonas y subzonas válidas
El propietario SHALL poder crear una zona vacía mediante un nombre obligatorio. El sistema MUST recortar espacios exteriores, aceptar entre 1 y 80 caracteres y permitir un padre válido del mismo evento sin superar tres niveles.

#### Scenario: Crear zona raíz vacía
- **WHEN** el propietario crea una zona con el nombre `  Recepción  ` sin padre
- **THEN** el sistema crea una zona raíz vacía llamada `Recepción`, incrementa la versión del evento y devuelve la estructura creada

#### Scenario: Crear subzona válida
- **WHEN** el propietario crea una zona dentro de otra zona de nivel 1 o 2
- **THEN** el sistema crea la subzona en el nivel correspondiente sin alterar otras zonas o módulos

#### Scenario: Nombre inválido
- **WHEN** el nombre queda vacío tras recortarlo o excede 80 caracteres
- **THEN** el sistema responde 422 y no escribe ningún cambio

#### Scenario: Cuarto nivel
- **WHEN** se intenta crear una zona dentro de una zona de nivel 3
- **THEN** el sistema responde 422 `package.group_depth_exceeded` y no escribe ningún cambio

### Requirement: Renombrar zonas sin reconstruir contenido
El propietario SHALL poder renombrar una zona conservando su identificador, padre, subzonas y módulos. El nombre MUST cumplir las mismas reglas de limpieza y longitud usadas al crear.

#### Scenario: Renombrar zona con contenido
- **WHEN** se renombra una zona que contiene módulos y subzonas con un nombre válido
- **THEN** solo cambia el nombre, se conserva todo el contenido y se incrementa una vez la versión del evento

#### Scenario: Renombrar con versión obsoleta
- **WHEN** el evento cambia antes de confirmar el renombrado
- **THEN** el sistema responde 409 `package.version_conflict` y conserva el nombre anterior

### Requirement: Mover zonas con jerarquía segura
El propietario SHALL poder mover una zona a la raíz o dentro de otra zona del mismo evento. El sistema MUST impedir que una zona quede dentro de sí misma o de cualquiera de sus descendientes y MUST rechazar cualquier movimiento cuyo subárbol exceda tres niveles.

#### Scenario: Mover subárbol válido
- **WHEN** se mueve una zona con sus módulos y subzonas a un padre válido
- **THEN** el sistema conserva los mismos identificadores y contenido, recalcula la profundidad de todo el subárbol e incrementa una vez la versión del evento

#### Scenario: Intentar ciclo
- **WHEN** se intenta mover una zona dentro de sí misma o de un descendiente
- **THEN** el sistema responde 422 `package.group_cycle` y mantiene la jerarquía anterior

#### Scenario: Intentar profundidad excesiva
- **WHEN** el destino haría que cualquier zona del subárbol superara el nivel 3
- **THEN** el sistema responde 422 `package.group_depth_exceeded` y mantiene la jerarquía anterior

### Requirement: Eliminar zonas con estrategia explícita
Eliminar una zona MUST requerir `move_to_root` o `delete_contents` y SHALL ejecutarse como una sola operación atómica. Ninguna estrategia puede dejar módulos o subzonas huérfanos.

#### Scenario: Mover contenido a raíz y eliminar
- **WHEN** se elimina una zona con `move_to_root`
- **THEN** sus módulos y subzonas directas pasan a la raíz, sus subárboles se conservan, la zona desaparece y la versión se incrementa una vez

#### Scenario: Eliminar zona y contenido
- **WHEN** se elimina una zona con `delete_contents`
- **THEN** la zona, todas sus subzonas y todos sus módulos se eliminan, se emite un evento de remoción por módulo y el presupuesto se reconcilia con la versión final

#### Scenario: Fallo durante eliminación
- **WHEN** falla cualquier escritura, evento o validación de una eliminación
- **THEN** la zona, su contenido, la versión y la outbox quedan exactamente como antes de la operación

#### Scenario: Estrategia ausente o inválida
- **WHEN** la solicitud no contiene una estrategia permitida
- **THEN** el sistema responde 400 y no escribe ningún cambio

### Requirement: Agregar módulos a raíz o zona
El propietario SHALL poder agregar desde el catálogo una nueva instancia de módulo a la raíz o a cualquier zona válida del evento. La selección de zona MUST NOT convertir el exceso de área en un bloqueo.

#### Scenario: Adición rápida a raíz
- **WHEN** el usuario usa la acción rápida existente sin seleccionar zona
- **THEN** el sistema agrega el módulo a la raíz y refresca contenido y diagnóstico espacial

#### Scenario: Agregar a zona
- **WHEN** el usuario selecciona una zona válida al agregar un módulo
- **THEN** el sistema crea la nueva instancia dentro de esa zona, incrementa la versión, registra `package.module.added` y reconcilia el presupuesto

#### Scenario: Área excedida
- **WHEN** el módulo agregado hace que el área requerida supere el área disponible
- **THEN** la operación termina correctamente y el diagnóstico informa el exceso sin bloquearla

### Requirement: Mover módulos preservando identidad
El propietario SHALL poder mover una instancia existente entre raíz y zonas válidas del mismo evento. La operación MUST conservar `itemId` y `moduleId`, MUST NOT modificar el catálogo y MUST confirmar asignación, versión y evento como una unidad atómica.

#### Scenario: Mover módulo entre ubicaciones
- **WHEN** se mueve un módulo de raíz a zona, entre zonas o de zona a raíz
- **THEN** se conserva la misma instancia, cambia únicamente su ubicación, se incrementa una vez la versión y se registra `package.module.moved`

#### Scenario: Destino ajeno o inexistente
- **WHEN** el destino no pertenece al evento o no existe
- **THEN** el sistema responde 404 sin modificar el módulo ni revelar otro evento

#### Scenario: Conflicto de versión al mover
- **WHEN** el evento cambia antes de confirmar el movimiento
- **THEN** el sistema responde 409 y conserva la ubicación anterior sin evento parcial

### Requirement: Contratos HTTP autenticados y no reveladores
Las mutaciones SHALL exponerse mediante `POST /api/packages/{packageId}/groups`, `PATCH|DELETE /api/packages/{packageId}/groups/{groupId}` y `PATCH /api/packages/{packageId}/items/{itemId}`. El sistema MUST validar sesión, propiedad, cuerpo y versión; recursos ajenos e inexistentes MUST ser indistinguibles.

#### Scenario: Usuario anónimo
- **WHEN** una solicitud sin sesión intenta cualquier mutación
- **THEN** el sistema responde 401 y no escribe cambios

#### Scenario: Evento o recurso ajeno
- **WHEN** un usuario autenticado intenta mutar un evento, zona o módulo ajeno o inexistente
- **THEN** el sistema responde 404 sin revelar cuál condición ocurrió

#### Scenario: Cuerpo inválido
- **WHEN** el JSON no tiene la forma requerida o contiene identificadores mal formados
- **THEN** el sistema responde 400 y no invoca una mutación persistente

#### Scenario: Regla de dominio inválida
- **WHEN** la forma HTTP es válida pero viola nombre, profundidad o ciclo
- **THEN** el sistema responde 422 con un código de dominio estable

### Requirement: Editor accesible y operativo
La interfaz SHALL usar el término visible "Zona", formularios progresivos inline y controles operables por teclado. Cada operación MUST representar estados normal, foco, pendiente, error y éxito; asociar errores al control; evitar doble envío; anunciar resultados; y devolver el foco a un destino lógico cuando desaparezca la fila activa.

#### Scenario: Crear con error accesible
- **WHEN** se envía un nombre inválido desde el formulario inline
- **THEN** el campo conserva un flujo recuperable, expone `aria-invalid`, referencia el error mediante `aria-describedby` y el error se anuncia

#### Scenario: Confirmar eliminación con contenido
- **WHEN** se activa "Eliminar" sobre una zona no vacía
- **THEN** la fila muestra inline "Mover contenido a la raíz y eliminar zona", "Eliminar zona y todo su contenido" y "Cancelar" sin abrir un modal

#### Scenario: Operación pendiente
- **WHEN** una mutación está en curso
- **THEN** el control anuncia estado pendiente y las guardas del cliente impiden un segundo envío

#### Scenario: Fila eliminada
- **WHEN** una operación elimina la fila que tenía el foco
- **THEN** el foco vuelve a un encabezado o acción contextual estable y una región `aria-live` anuncia el resultado

#### Scenario: Jerarquía desplegable
- **WHEN** el usuario expande o contrae una zona en "Contenido del evento"
- **THEN** el control expone `aria-expanded` y la jerarquía muestra nombre, número de elementos, área y subtotal en escritorio y móvil

### Requirement: Plantillas conservan zonas editadas
Guardar un evento como plantilla y crear otro evento desde ella SHALL copiar la jerarquía final de zonas y la ubicación de módulos con identificadores nuevos. Las copias MUST permanecer independientes.

#### Scenario: Copiar editor completo mediante plantilla
- **WHEN** un evento con dos zonas, una subzona y módulos en raíz y zonas se guarda como plantilla y luego se instancia
- **THEN** el nuevo evento conserva nombres, jerarquía y ubicaciones con IDs nuevos

#### Scenario: Independencia posterior
- **WHEN** se renombra, mueve o elimina una zona del evento instanciado
- **THEN** la plantilla y el evento fuente permanecen sin cambios
