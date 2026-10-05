# Proposal

## Why

DecorAR necesita exponer su catálogo persistido mediante una API HTTP (`GET /api/modules`) para que el cliente frontend consulte los módulos disponibles sin acceder directamente a la base de datos Supabase desde el navegador. Para habilitar el desarrollo paralelo de la interfaz sin bloquear a otros colaboradores y garantizar la integridad de los datos, el catálogo debe estructurarse siguiendo Clean Architecture (DECOR-17), validar reglas estrictas de activación en base de datos y proveer un fixture JSON inicial con los contratos acordados.

## What Changes

- Crear la migración SQL para la tabla `catalog_modules` con restricciones de integridad (`price_cop > 0`, `area_m2 > 0`, dimensiones positivas, unicidad `(asset_id, version)` y restricción de completitud para `status = 'active'`).
- Habilitar RLS con política de lectura pública exclusiva para módulos activos.
- Añadir el seed SQL reproducible con los 3 módulos iniciales (`mesa`, `arco`, `pista`) en estado `draft`.
- Crear un fixture JSON representativo en `public/fixtures/catalog-modules.json` para desacoplar el desarrollo de UI de Mei.
- Implementar las capas de Clean Architecture para el catálogo bajo `src/modules/catalog/`:
  - `domain`: Entidad `CatalogModule` y validación de invariantes.
  - `application`: Puerto `CatalogRepository`, DTO con campos `camelCase` y caso de uso `GetActiveCatalogModulesUseCase`.
  - `infrastructure`: Adaptador `SupabaseCatalogRepository` que consulta PostgreSQL mediante el cliente server-side de Supabase.
- Implementar el adaptador de entrada `CatalogController` en `src/interfaces/catalog/` y registrar su construcción en `src/composition/server.ts`.
- Exponer el Route Handler `GET /api/modules` en `src/app/api/modules/route.ts` retornando únicamente módulos activos en `camelCase` y manejando errores con status 500 seguro y `correlationId`.
- Agregar pruebas unitarias de dominio, aplicación, interfaz y de ruta.

## Capabilities

### New Capabilities

- `catalog-contract`: Esquema persistido de `catalog_modules`, reglas de integridad de catálogo, puerto y adaptador server-side, Route Handler `GET /api/modules` y fixture mock para desarrollo desacoplado.

## Impact

- Añade archivos bajo `supabase/migrations/` y `supabase/seed.sql`.
- Añade fixture en `public/fixtures/catalog-modules.json`.
- Añade código modular bajo `src/modules/catalog/`, `src/interfaces/catalog/` y `src/app/api/modules/`.
- Actualiza `src/composition/server.ts` sin romper compatibilidad existente.
- Cumple con las restricciones de `scripts/scan-architecture.ts` y no filtra credenciales al bundle cliente.
