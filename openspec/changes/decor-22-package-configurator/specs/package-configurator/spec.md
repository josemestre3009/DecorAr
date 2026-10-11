# Spec Delta

## Purpose

Configurador de `/packages/{id}`: muestra el paquete real y permite agregar, quitar, ver grupos y duplicar, haciendo observables Builder, Composite y Prototype.

## ADDED Requirements

### Requirement: Resumen del espacio desde el servidor

El configurador SHALL mostrar el tipo de espacio descriptivo, la capacidad ingresada al crear el paquete y el área usada y restante calculadas en el servidor; la interfaz MUST NOT usar capacidades fijas.

#### Scenario: Fixture de 30 m²

- **WHEN** un paquete de 30 m² tiene una pista de baile (16 m²) y se intenta agregar otra
- **THEN** la API responde 422, el mensaje muestra "(32/30 m²)" y el contenido y el área usada no cambian

#### Scenario: Otra capacidad

- **WHEN** el paquete tiene 50 m²
- **THEN** entran dos pistas y el resumen muestra 32 m² usados y 18 m² restantes

### Requirement: Contenido con hojas y grupos

El configurador SHALL listar las hojas agrupadas por módulo con su cantidad y subtotal informativo, y los grupos con un control que despliega sus hijos y expone `aria-expanded`.

#### Scenario: Zona de bienvenida

- **WHEN** el paquete tiene el grupo "Zona de bienvenida"
- **THEN** el grupo aparece contraído y, al desplegarlo, muestra el arco floral y la mesa redonda

### Requirement: Quitar y refrescar desde el servidor

Quitar SHALL llamar a `DELETE /api/packages/{id}/items/{itemId}` y, si responde 204, volver a leer la página del servidor; si falla, MUST mostrar el error junto al elemento sin cambiar el contenido.

#### Scenario: Error al quitar

- **WHEN** el DELETE responde 409
- **THEN** se muestra el mensaje junto al elemento, la cantidad no cambia y se puede reintentar

### Requirement: Total confirmado de Presupuesto

El configurador SHALL mostrar el total que persiste Presupuesto y MUST NOT calcularlo en el cliente.

#### Scenario: Paquete sin presupuesto

- **WHEN** `GetBudgetUseCase` responde `budget.not_found`
- **THEN** se muestra "Presupuesto aún no calculado"

### Requirement: Clon independiente

Duplicar SHALL navegar al paquete nuevo, y los cambios en el clon MUST NOT afectar al original.

#### Scenario: Quitar en el clon

- **WHEN** se duplica un paquete con dos pistas y se quita una en el clon
- **THEN** el clon muestra una pista y el original sigue con dos

### Requirement: Paquete ajeno

Un paquete ajeno o inexistente MUST responder 404 sin revelar que existe.

#### Scenario: Id ajeno

- **WHEN** un usuario abre `/packages/{id}` de otro usuario
- **THEN** la página responde 404
