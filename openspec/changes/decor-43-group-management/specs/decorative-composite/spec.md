# Spec Delta

## Purpose

Gestión de zonas (grupos decorativos) de un paquete: renombrarlas, eliminarlas sin perder contenido, organizarlas antes del catálogo, elegirlas como destino y conservarlas al duplicar.

## ADDED Requirements

### Requirement: Renombrar un grupo

`PATCH /api/packages/{packageId}/groups/{groupId}` SHALL cambiar solo el nombre del grupo (texto recortado de 1 a 80 caracteres); hijos, hojas, subtotales y jerarquía MUST NOT cambiar.

#### Scenario: Nombre válido

- **WHEN** el dueño guarda "Sala principal" para un grupo existente
- **THEN** responde 200 con el nombre recortado y la versión estructural nueva, y el árbol queda igual

#### Scenario: Nombre inválido

- **WHEN** el nombre está vacío o supera 80 caracteres
- **THEN** responde 400 `package.invalid_group_name` y el grupo conserva su nombre anterior

### Requirement: Eliminar un grupo sin perder contenido

`DELETE /api/packages/{packageId}/groups/{groupId}` SHALL borrar el grupo y mover sus hojas y subgrupos al padre del grupo, o al nivel principal si era raíz, en una sola transacción; MUST NOT eliminar hojas ni subgrupos.

#### Scenario: Grupo raíz

- **WHEN** se elimina un grupo raíz con hojas y subgrupos
- **THEN** responde 204, las hojas quedan en la raíz y cada descendiente sube un nivel

#### Scenario: Subgrupo

- **WHEN** se elimina un subgrupo con contenido
- **THEN** sus hojas y subgrupos pasan al grupo padre

#### Scenario: Fallo al promover

- **WHEN** la promoción no puede completarse
- **THEN** ningún grupo, hoja o relación queda modificado

### Requirement: Cambios estructurales sin eventos ni recálculo

Renombrar y eliminar MUST NOT emitir eventos de módulo ni recalcular el presupuesto, y MUST NOT cambiar `packages.version`; SHALL incrementar `packages.structure_version`.

#### Scenario: Eliminar no recalcula

- **WHEN** se elimina un grupo con hojas
- **THEN** la outbox, `packages.version` y el presupuesto confirmado no cambian

### Requirement: Propiedad y concurrencia

Las operaciones SHALL exigir sesión (401) y propiedad del paquete (404 `package.not_found`), y MUST rechazar con 409 `package.version_conflict` un paquete que cambió entre la lectura y la escritura.

#### Scenario: Usuario ajeno

- **WHEN** otro usuario intenta renombrar o eliminar un grupo del paquete
- **THEN** responde 404 y no cambia nada

### Requirement: Organización opcional antes del catálogo

En modo live, crear el paquete SHALL navegar a `/packages/{packageId}/groups/setup`, donde el usuario crea, renombra y elimina zonas y puede continuar u omitir hacia `/packages/{packageId}`; el configurador SHALL ofrecer "Administrar zonas". En modo simulado el paso MUST omitirse.

#### Scenario: Omitir

- **WHEN** un paquete sin zonas elige "Omitir por ahora"
- **THEN** llega al configurador y agrega módulos al nivel principal

#### Scenario: Modo simulado

- **WHEN** se crea un paquete en modo simulado
- **THEN** va directo al configurador y no se ofrecen zonas

### Requirement: Zona de destino en el catálogo

El catálogo SHALL ofrecer como destino el nivel principal o cualquier zona con su ruta jerárquica legible y enviar `parentGroupId` al agregar.

#### Scenario: Agregar a una zona

- **WHEN** el usuario elige "Sala › Mesa" y agrega un módulo
- **THEN** el módulo aparece dentro de esa zona y el área, el contenido y el presupuesto se resincronizan

### Requirement: Duplicación estructural

Duplicar un paquete SHALL conservar zonas, subzonas, elementos y relaciones con identificadores nuevos, MUST impedir un doble envío y SHALL mostrar una confirmación en el configurador de la copia.

#### Scenario: Copia independiente

- **WHEN** se duplica un paquete con zonas y luego se elimina una zona de la copia
- **THEN** el original conserva su jerarquía
