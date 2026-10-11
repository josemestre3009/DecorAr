# Spec Delta

## Purpose

Grupos decorativos (Composite) dentro de un paquete: hojas y grupos comparten contrato, los grupos se anidan hasta tres niveles sin ciclos y se persisten sin escrituras parciales.

## ADDED Requirements

### Requirement: Contrato común para hojas y grupos

El dominio SHALL exponer `ComponenteDecorativo`, implementado por `ElementoDecorativo` (hoja) y `ModuloCompuesto` (grupo); precio y área de un grupo MUST ser la suma recursiva de sus hojas, sin monto propio.

#### Scenario: Zona de bienvenida

- **WHEN** se crea "Zona de bienvenida" con un arco floral (200 000 COP, 2 m²) y una mesa redonda (250 000 COP, 4 m²)
- **THEN** el grupo suma 450 000 COP y 6 m², igual que sumar las dos hojas por separado

#### Scenario: El Builder usa el contrato común

- **WHEN** el Builder agrega la Zona de bienvenida y una pista de baile
- **THEN** el paquete valida capacidad y calcula área y presupuesto recorriendo `ComponenteDecorativo`

### Requirement: Máximo tres niveles y sin ciclos

El sistema MUST rechazar un cuarto nivel de grupos y cualquier ciclo, en el dominio antes del RPC y en la base de datos como defensa.

#### Scenario: Cuarto nivel

- **WHEN** se crea un grupo dentro de un grupo de nivel 3
- **THEN** responde 422 `package.group_depth_exceeded` y no escribe nada

#### Scenario: Ciclo

- **WHEN** se intenta poner un grupo dentro de sí mismo o de un descendiente
- **THEN** el dominio responde `package.group_cycle` y la base rechaza re-asignar el padre con `package.group_immutable`

### Requirement: Creación atómica de grupos

`POST /api/packages/{packageId}/groups` SHALL crear el grupo y sus hojas con una sola RPC PostgreSQL; cada hoja MUST emitir `package.module.added` en la misma transacción y un grupo sin hojas MUST NOT emitir eventos.

#### Scenario: Falla un hijo

- **WHEN** falla la inserción de una de las hojas
- **THEN** no queda el grupo, ni las demás hojas, ni filas en la outbox

#### Scenario: Grupo sin hojas

- **WHEN** se crea un grupo vacío
- **THEN** la versión del paquete no cambia y no se recalcula el presupuesto

### Requirement: Propiedad del paquete

Solo el dueño MUST poder crear grupos o agregar hojas a grupos de su paquete; el Route Handler, la RPC y RLS lo comprueban de forma independiente.

#### Scenario: Usuario ajeno

- **WHEN** el usuario B intenta crear un grupo en el paquete de A
- **THEN** el handler responde 404, la RPC lanza `package.not_found` y RLS oculta los grupos de A a B

### Requirement: La clonación conserva los grupos

`clone_package` SHALL copiar los grupos con ids nuevos y la misma estructura, y cada hoja copiada MUST quedar en el grupo copiado equivalente.

#### Scenario: Clonar un paquete con grupos anidados

- **WHEN** se clona un paquete con "Zona de bienvenida" y un subgrupo
- **THEN** el clon tiene ambos grupos con ids distintos, la misma jerarquía y las hojas en sus grupos
