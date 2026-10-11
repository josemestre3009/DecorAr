# Spec Delta

## Purpose

Evidencia reproducible de Catálogo, Builder, Prototype y Composite a través de la API y persistencia (DECOR-26 / Actividad.md 8.17-8.18).

## ADDED Requirements

### Requirement: Pruebas de integración de endpoints de paquetes y catálogo

El sistema SHALL contar con pruebas automatizadas reproducibles para todos los endpoints de catálogo (`GET /api/modules`), paquetes (`POST /api/packages`), ítems (`POST /api/packages/{id}/items`, `DELETE /api/packages/{id}/items/{itemId}`), clonación (`POST /api/packages/{id}/clone`) y grupos (`POST /api/packages/{id}/groups`).

#### Scenario: Catálogo activo responde 200 OK con encabezado de caché
- **GIVEN** módulos activos en la base de datos
- **WHEN** cualquier cliente consulta `GET /api/modules`
- **THEN** responde HTTP 200 con la lista de módulos y `Cache-Control: public, max-age=60, s-maxage=300`

### Requirement: Demostración del patrón Builder y control de capacidad

El sistema SHALL reproducir los tres fixtures del patrón Builder mediante endpoints de API y validar la capacidad de espacio sin emitir eventos ante rechazos.

#### Scenario: Paquete para salón social y paquete básico del Director
- **GIVEN** un usuario autenticado
- **WHEN** arma el salón social con 2 mesas, 1 arco y 1 pista de baile
- **THEN** persiste 4 ítems (26 m² usados), incrementa la versión y emite 4 eventos en outbox

#### Scenario: Rechazo por capacidad excedida no emite eventos
- **GIVEN** un espacio de 30 m² con una pista de baile de 16 m²
- **WHEN** se intenta agregar una segunda pista de baile (32 m² en total)
- **THEN** responde HTTP 422 (`package.capacity_exceeded`), no incrementa la versión y no escribe eventos en `private.domain_events`

### Requirement: Demostración del patrón Prototype y copia profunda

El sistema SHALL clonar paquetes de forma profunda a través de `POST /api/packages/{id}/clone`, garantizando que las mutaciones sobre el clon no afecten al original.

#### Scenario: Eliminación de ítems en el clon preserva el paquete original
- **GIVEN** un paquete clonado con 2 ítems
- **WHEN** se elimina un ítem del clon con `DELETE /items/{itemId}`
- **THEN** el clon queda con 1 ítem y el paquete original conserva sus 2 ítems intactos

### Requirement: Demostración del patrón Composite y control de jerarquías

El sistema SHALL permitir la creación de grupos decorativos hasta 3 niveles de profundidad y prevenir la formación de ciclos.

#### Scenario: Creación de la Zona de bienvenida
- **GIVEN** un paquete existente
- **WHEN** se crea el grupo "Zona de bienvenida" con arco floral y mesa redonda
- **THEN** responde HTTP 201 Created con `depth: 1` y los ítems asociados al grupo

#### Scenario: Cuarto nivel de profundidad rechazado
- **GIVEN** un paquete con 3 niveles de grupos anidados
- **WHEN** se intenta crear un cuarto nivel
- **THEN** responde HTTP 422 (`package.group_depth_exceeded`) sin persistir filas

### Requirement: Reseteo y limpieza de base de datos server-side

El sistema SHALL contar con un script SQL versionado en el repositorio (`supabase/reset-test-database.sql`) capaz de limpiar de forma transaccional el estado mutable sin requerir CLI local.

#### Scenario: Limpieza repetible
- **GIVEN** una base de datos con paquetes, ítems, grupos, presupuestos y eventos
- **WHEN** se ejecuta el script de reseteo server-side
- **THEN** todas las tablas mutables quedan vacías y los módulos del catálogo permanecen intactos
