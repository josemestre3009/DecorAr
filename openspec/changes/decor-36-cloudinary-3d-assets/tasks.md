# Tasks

## 1. Esquema y migración RPC

- [x] 1.1 Crear migración SQL `supabase/migrations/20261006000000_activate_catalog_module_rpc.sql` con `SECURITY INVOKER` y `SET search_path = ''`
- [x] 1.2 Aplicar la migración a la base de datos Supabase y verificar función creada

## 2. Dependencias y configuración de entorno

- [x] 2.1 Instalar paquete `cloudinary` en `package.json`
- [x] 2.2 Agregar helper `getCloudinaryEnv` en `src/lib/env.ts`

## 3. Puertos y adaptadores Clean Architecture

- [x] 3.1 Crear puertos `AssetStoragePort` y `CatalogActivationPort` en `src/modules/catalog/application/ports/`
- [x] 3.2 Crear caso de uso `PublishAndActivateModuleUseCase` con validaciones de límites y manejo de rollback en `src/modules/catalog/application/use-cases/`
- [x] 3.3 Implementar adaptador `CloudinaryAssetStorage` en `src/modules/catalog/infrastructure/`
- [x] 3.4 Implementar adaptador `SupabaseCatalogActivationAdapter` en `src/modules/catalog/infrastructure/`

## 4. Script CLI y pruebas

- [x] 4.1 Implementar script CLI `scripts/publish-catalog-assets.ts` y script npm `"catalog:publish-assets"`
- [x] 4.2 Crear pruebas unitarias y de integración para caso de uso, adaptadores y validaciones
- [x] 4.3 Ejecutar publicación real de 3x3 activos y activación de mesa, arco y pista
- [x] 4.4 Ejecutar suite completa de tests, escáner de arquitectura, secretos, lint, typecheck y build
