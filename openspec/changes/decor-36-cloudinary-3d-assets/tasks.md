# Tasks

## 1. Esquema y migración RPC
- [x] 1.1 Crear migración SQL `supabase/migrations/20261006000000_activate_catalog_module_rpc.sql` con `SECURITY INVOKER` y `SET search_path = ''`
- [x] 1.2 Restringir RPC a filas `status = 'draft'` con bloqueo `FOR UPDATE` e inmutabilidad garantizada (F2)
- [x] 1.3 Aplicar la migración a la base de datos Supabase y verificar función creada

## 2. Dependencias y configuración de entorno
- [x] 2.1 Instalar paquete `cloudinary` en `package.json`
- [x] 2.2 Agregar helper `getCloudinaryEnv` en `src/lib/env.ts`

## 3. Puertos y adaptadores Clean Architecture
- [x] 3.1 Crear puertos agnósticos `AssetStoragePort` y `CatalogActivationPort` en `src/modules/catalog/application/ports/`
- [x] 3.2 Implementar idempotencia en `CloudinaryAssetStorage` con recuperación de metadatos vía `api.resource` ante activos existentes (F1)
- [x] 3.3 Implementar adaptador `SupabaseCatalogActivationAdapter` en `src/modules/catalog/infrastructure/`
- [x] 3.4 Crear caso de uso `PublishAndActivateModuleUseCase` con validaciones de límites (GLB/USDZ <= 15MB, poster <= 1MB) y política de reintento idempotente

## 4. Script CLI y herramientas de medición
- [x] 4.1 Implementar utilidad de inspección de Bounding Box GLB en `scripts/inspect-glb-bounds.ts` (F3)
- [x] 4.2 Implementar script CLI `scripts/publish-catalog-assets.ts` con logging de geometría y dimensiones
- [x] 4.3 Publicación de los 9 activos en Cloudinary y activación atómica de mesa, arco y pista en Supabase

## 5. Documentación y especificaciones
- [x] 5.1 Crear guía técnica y operativa `docs/assets-3d.md` (F4)
- [x] 5.2 Crear especificación delta formal en `openspec/changes/decor-36-cloudinary-3d-assets/specs/cloudinary-3d-assets/spec.md` (F4)
- [x] 5.3 Documentar publicación versionada, reintento, rollback y limpieza segura (F4)

## 6. Pruebas y verificación de calidad
- [x] 6.1 Pruebas unitarias para caso de uso, adaptadores, RPC contract y cálculo de bounding box
- [x] 6.2 Pruebas de replay sobre módulos ya activos (inmutabilidad) y recuperación ante `{ existing: true }`
- [x] 6.3 Ejecutar suite completa de tests, escáner de arquitectura, escáner de secretos, lint, typecheck y build
- [x] 6.4 Verificar factores de calibración geométrica y default no destructivo de Cloudinary (F3/F5)
