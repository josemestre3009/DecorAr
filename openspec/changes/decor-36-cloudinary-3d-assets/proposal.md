# Proposal

## Why

DECOR-36 requiere configurar Cloudinary de forma server-only y publicar los activos 3D versionados (GLB, USDZ y poster) para los tres módulos iniciales del catálogo (`mesa`, `arco`, `pista`). Para garantizar que ningún módulo quede en estado parcial en la base de datos tras una subida incompleta o inválida, se debe implementar una función RPC atómica en Supabase con `SECURITY INVOKER` y `search_path = ''`. Además, el proceso debe respetar estrictamente Clean Architecture desacoplando el almacenamiento externo mediante puertos de aplicación y adaptadores en la capa de infraestructura.

## What Changes

- Crear la migración SQL con la función RPC `public.activate_catalog_module` con `SECURITY INVOKER`, `SET search_path = ''` y validación atómica.
- Agregar dependencia oficial `cloudinary` en el servidor y configurar helper seguro en `src/lib/env.ts`.
- Diseñar puertos y adaptadores en `src/modules/catalog/`:
  - Puerto `AssetStoragePort` y adaptador `CloudinaryAssetStorage` (`server-only`, `resource_type: "raw" | "image"`, `overwrite: false`).
  - Puerto `CatalogActivationPort` y adaptador `SupabaseCatalogActivationAdapter`.
  - Caso de uso `PublishAndActivateModuleUseCase` con validación previa de límites (GLB/USDZ <= 15MB, poster <= 1MB), inmutabilidad de versión y atomicidad (si falla cualquier subida, no se toca la BD).
- Script CLI seguro `scripts/publish-catalog-assets.ts` y script npm `"catalog:publish-assets"`.
- Validar y optimizar los activos locales en `assets/3d/` para que cumplan con los límites.
- Pruebas unitarias y de integración para caso de uso, adaptadores, RPC, validación de archivos y ausencia de secretos en el cliente.
- Publicación real de los 3x3 activos en Cloudinary y activación atómica de los 3 módulos en Supabase.

## Capabilities

### New Capabilities

- `cloudinary-3d-assets`: Publicación automatizada e inmutable de modelos 3D y posters en Cloudinary, y activación atómica de módulos de catálogo mediante RPC en PostgreSQL.

## Impact

- Añade migración SQL `supabase/migrations/20261006000000_activate_catalog_module_rpc.sql`.
- Añade migración correctiva `supabase/migrations/20261007000000_replace_active_catalog_version.sql` para sustitución atómica y dimensiones nativas.
- Añade puertos, adaptadores y caso de uso bajo `src/modules/catalog/`.
- Añade script ejecutable `scripts/publish-catalog-assets.ts`.
- Añade dependencia `cloudinary` en `package.json`.
- Mantiene los módulos en `src/modules/*/domain` libres de frameworks y librerías externas.
