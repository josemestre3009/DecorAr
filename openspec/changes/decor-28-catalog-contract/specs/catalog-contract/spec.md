# Spec Delta

## Purpose

Establece el esquema persistido de base de datos, las reglas de integridad de módulos, el contrato de la API HTTP y la entrega de datos mock para el catálogo de DecorAR.

## ADDED Requirements

### Requirement: Esquema y restricciones de base de datos para catálogo
La base de datos PostgreSQL SHALL proveer la tabla `catalog_modules` con clave única `(asset_id, version)`, valores positivos para precio y área, y restricciones que impidan guardar módulos en estado `active` si carecen de modelos 3D (`glb_url`, `usdz_url`) o dimensiones (`width_m`, `height_m`, `depth_m`).

#### Scenario: Inserción de borrador incompleto
- **WHEN** se inserta un módulo con `status = 'draft'` sin enlaces 3D ni dimensiones
- **THEN** la base de datos acepta la inserción correctamente

#### Scenario: Rechazo de módulo activo incompleto
- **WHEN** se intenta guardar o actualizar un módulo a `status = 'active'` sin `glb_url`, `usdz_url` o dimensiones
- **THEN** la base de datos rechaza la operación por violación de restricción CHECK

#### Scenario: Rechazo de precio o área no positivos
- **WHEN** se intenta registrar un módulo con `price_cop <= 0` o `area_m2 <= 0`
- **THEN** la base de datos rechaza la operación por violación de restricción CHECK

#### Scenario: Unicidad de activo y versión
- **WHEN** se intenta insertar una combinación existente de `asset_id` y `version`
- **THEN** la base de datos rechaza la operación por violación de unicidad

### Requirement: Consulta de módulos activos vía API HTTP
El sistema SHALL exponer el endpoint `GET /api/modules` que consulte la persistencia en el servidor mediante Clean Architecture y retorne exclusivamente los módulos en estado `active` transformados a `camelCase`.

#### Scenario: Consulta de catálogo con módulos en borrador
- **WHEN** un cliente HTTP solicita `GET /api/modules` y sólo existen registros en estado `draft`
- **THEN** la API responde código `200` con un arreglo JSON vacío `[]`

#### Scenario: Consulta de catálogo con módulos activos
- **WHEN** un cliente HTTP solicita `GET /api/modules` y existen registros en estado `active`
- **THEN** la API responde código `200` con los campos `id`, `name`, `priceCop`, `areaM2`, `widthM`, `heightM`, `depthM`, `glbUrl`, `usdzUrl`, `posterUrl`, `assetId` y `version`

#### Scenario: Manejo controlado de error interno
- **WHEN** ocurre una excepción o falla de conectividad en la persistencia del catálogo
- **THEN** la API responde código `500` con un payload JSON genérico que incluye `correlationId` y no expone detalles técnicos sensibles

### Requirement: Fixture mock para desarrollo desacoplado
El proyecto SHALL proveer un archivo JSON estático con la estructura idéntica de respuesta de la API que contenga los 3 módulos base para facilitar el desarrollo independiente del frontend.

#### Scenario: Lectura del fixture de catálogo
- **WHEN** se lee el archivo `public/fixtures/catalog-modules.json`
- **THEN** contiene un arreglo con los módulos `mesa`, `arco` y `pista` cumpliendo el contrato de campos `camelCase` de la API
