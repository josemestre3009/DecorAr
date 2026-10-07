# Spec Delta

## Purpose

Establece las especificaciones para la subida idempotente de modelos 3D y posters en Cloudinary, la inmutabilidad de versiones publicadas, y la activación atómica de módulos en Supabase mediante una función RPC con `SECURITY INVOKER`.

## ADDED Requirements

### Requirement: Almacenamiento seguro e inmutable de activos 3D en Cloudinary
El sistema SHALL proveer la capacidad de subir archivos de modelos 3D (`.glb` y `.usdz`) en formato `raw` y vistas previas (`poster`) en formato `image` a Cloudinary con `overwrite: false`, identificadores versionados deterministas `decorar/{assetId}/v{version}/{filename}`, y manejo idempotente ante recursos existentes.

#### Scenario: Subida exitosa de los 3 archivos de un módulo
- **WHEN** se envían archivos válidos `.glb`, `.usdz` y poster que no exceden los límites de tamaño (GLB/USDZ $\le 15\text{ MB}$, poster $\le 1\text{ MB}$)
- **THEN** se suben a Cloudinary bajo identificadores versionados inmutables y se obtienen sus URLs seguras HTTPS

#### Scenario: Rechazo por exceder límite de tamaño
- **WHEN** un archivo `.glb` o `.usdz` supera 15 MB, o un poster supera 1 MB
- **THEN** el caso de uso aborta antes de iniciar cualquier subida y retorna un error de dominio con código `catalog.file_too_large`

#### Scenario: Reejecución idempotente ante activo existente (F1)
- **WHEN** un activo ya existe en Cloudinary con el mismo `public_id` y se intenta publicar nuevamente con política `ifExists: "reuse"`
- **THEN** el adaptador recupera los metadatos y la URL segura del recurso existente sin fallar ni duplicar el archivo

### Requirement: Activación atómica e inmutable en Supabase (RPC)
La base de datos PostgreSQL SHALL proveer la función RPC `public.activate_catalog_module` con `SECURITY INVOKER`, `SET search_path = ''`, que verifique que el registro a activar esté en estado `draft`, aplique bloqueo pesimista `FOR UPDATE`, y actualice atómicamente a `active` con URLs y dimensiones físicas.

#### Scenario: Activación exitosa de módulo en borrador
- **WHEN** se invoca `activate_catalog_module` con parámetros válidos para un registro existente con `status = 'draft'`
- **THEN** actualiza `glb_url`, `usdz_url`, `poster_url`, dimensiones, y cambia `status` a `'active'`, retornando el registro actualizado

#### Scenario: Rechazo de activación si el módulo ya está activo (F2)
- **WHEN** se invoca `activate_catalog_module` para una versión de módulo que ya tiene `status = 'active'`
- **THEN** la base de datos rechaza la operación arrojando una excepción que indica que el módulo no se encuentra en estado `draft`

#### Scenario: Rechazo si el módulo no existe
- **WHEN** se invoca `activate_catalog_module` con un `asset_id` o `version` inexistente
- **THEN** la función arroja una excepción indicando que el módulo no fue encontrado

### Requirement: Validación y calibración de dimensiones 1:1 (F3)
El sistema SHALL proveer la utilidad `scripts/inspect-glb-bounds.ts` para extraer el Bounding Box transformado de los archivos GLB y evidenciar la coherencia geométrica frente a las dimensiones físicas calibradas para la experiencia AR a escala fija.

#### Scenario: Cálculo de Bounding Box desde archivo GLB
- **WHEN** se procesa un archivo binario `.glb` válido
- **THEN** el script extrae los vértices mínimos y máximos multiplicando las matrices locales y jerárquicas del grafo de escena glTF, reportando ancho, alto y profundidad en metros
