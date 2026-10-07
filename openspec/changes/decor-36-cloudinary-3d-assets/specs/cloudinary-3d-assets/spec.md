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

### Requirement: Validación de dimensiones físicas 1:1 (F3)
El sistema SHALL exportar GLB y USDZ con una escala uniforme basada en la referencia física aprobada para cada módulo. El flujo SHALL medir los archivos resultantes y persistir el Bounding Box del GLB en metros, sin escala anisotrópica de runtime.

#### Scenario: Cálculo de Bounding Box desde archivo GLB
- **WHEN** se procesa un archivo binario `.glb` válido
- **THEN** el script extrae los vértices mínimos y máximos multiplicando las matrices locales y jerárquicas del grafo de escena glTF, reportando ancho, alto y profundidad en metros

#### Scenario: Publicación de dimensiones verificables
- **WHEN** se publica un GLB válido
- **THEN** el comando pasa el Bounding Box del archivo ya reexportado a la activación del catálogo y GLB/USDZ conservan las mismas dimensiones físicas con el cambio esperado de ejes

#### Scenario: Modelo que requiere otro tamaño físico
- **WHEN** una ficha técnica independiente exige dimensiones distintas a las nativas
- **THEN** el operador debe corregir y exportar uniformemente GLB y USDZ como una versión nueva antes de publicarla; el sistema no deforma ejes durante el consumo AR

### Requirement: Operación versionada y recuperable
El comando de publicación SHALL permitir seleccionar el módulo y la versión, mantener versiones publicadas inmutables y reemplazar atómicamente la única versión vigente por `asset_id`, conservando la anterior como `retired`.

#### Scenario: Publicación de una versión nueva
- **WHEN** el operador ejecuta el comando con `--asset=<assetId> --version=<n>` y existe la carpeta y fila `draft` correspondientes
- **THEN** el sistema publica únicamente ese módulo bajo `v<n>`, cambia la versión activa anterior a `retired` y deja exactamente una versión `active`

#### Scenario: Intentos concurrentes de reemplazo
- **WHEN** dos versiones del mismo `asset_id` intentan activarse concurrentemente
- **THEN** la RPC serializa ambas transacciones por `asset_id` y el índice único parcial impide más de una fila `active`

#### Scenario: Recuperación de un intento parcial
- **WHEN** una publicación falla antes de activar la fila `draft`
- **THEN** el operador puede reintentar reutilizando los activos existentes o limpiar exclusivamente esa versión después de confirmar que ninguna fila `active` la referencia
