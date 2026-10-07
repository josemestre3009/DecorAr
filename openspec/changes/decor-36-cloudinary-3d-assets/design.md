# Design

## Context

DECOR-28 implementó el contrato de base de datos y la API de lectura de catálogo (`GET /api/modules`) consumiendo únicamente módulos en estado `active`. Los 3 módulos iniciales (`mesa`, `arco`, `pista`) se encuentran en estado `draft` sin URLs ni dimensiones definitivas. DECOR-36 completa el ciclo publicando los activos 3D a Cloudinary e invocando una función RPC en PostgreSQL para activar atómicamente cada módulo sin generar estados parciales.

## Goals / Non-Goals

**Goals:**

- Subir GLB y USDZ con `resource_type: "raw"` y posters con `resource_type: "image"`.
- Garantizar versionado e inmutabilidad: `public_id` con formato `decorar/{assetId}/v{version}/{filename}` y `overwrite: false`.
- Validar límites estrictos de tamaño: GLB/USDZ <= 15 MB, posters <= 1 MB antes de cualquier transferencia.
- Función RPC `public.activate_catalog_module` con `SECURITY INVOKER`, `SET search_path = ''` y actualización atómica en PostgreSQL.
- Aislar Cloudinary y Supabase tras puertos de aplicación en Clean Architecture.
- Mantener `CLOUDINARY_URL` estrictamente server-only verificado por escáneres estáticos.
- Proveer un comando reproducible `npm run catalog:publish-assets` mediante un script CLI en `scripts/publish-catalog-assets.ts`.
- Publicar el Bounding Box nativo GLB como dimensiones métricas, sin escalado anisotrópico de runtime.
- Mantener exactamente una versión `active` por `asset_id`; versiones sustituidas quedan `retired` e inmutables.

**Non-Goals:**

- Crear endpoints HTTP de mutación públicos en Next.js (el MVP de catálogo es solo lectura por API; la publicación es un flujo operativo).
- Detectar obstáculos o mallas de escaneo (explícitamente fuera del alcance en comentarios de DECOR-36).

## Decisions

### Función RPC en PostgreSQL con SECURITY INVOKER y search_path vacío
Para asegurar que no ocurran actualizaciones parciales (por ejemplo, guardar el GLB pero fallar en el USDZ o dimensiones), PostgreSQL encapsula la validación y el paso de `draft -> active` en una función atómica. La directiva `SECURITY INVOKER` delega los permisos al llamador (cliente administrativo en servidor) y `SET search_path = ''` previene vectores de inyección en el esquema.

### Clean Architecture: Ports & Adapters para Almacenamiento y Activación
En lugar de acoplar el script directamente al SDK de Cloudinary o Supabase:
- `AssetStoragePort` abstrae la subida de archivos binarios e imágenes.
- `CatalogActivationPort` abstrae la llamada al procedimiento de base de datos.
- `PublishAndActivateModuleUseCase` orquesta la validación, la carga de los 3 archivos y la invocación de la activación.
- El adaptador `CloudinaryAssetStorage` implementa el puerto usando el SDK oficial con `server-only`.

### Escala nativa y reemplazo de versión
glTF 2.0 define metros como unidad lineal. El publicador deriva `width_m`, `height_m` y `depth_m` del Bounding Box transformado del GLB y no admite dimensiones manuales. Esto evita la calibración circular y funciona con Scene Viewer, que descarga el archivo original sin aplicar transformaciones del DOM. Si existe una medida física independiente, GLB y USDZ deben reexportarse uniformemente antes de crear una versión nueva.

La RPC serializa activaciones por `asset_id`, retira la versión vigente y activa la nueva dentro de una transacción. Un índice único parcial garantiza una sola fila `active`; las filas `retired` conservan URLs y metadatos históricos.

## Risks / Trade-offs

- [Archivos superando límites de tamaño] -> `PublishAndActivateModuleUseCase` valida antes de subir y falla si algún archivo excede 15 MB o 1 MB.
- [Fallo parcial durante subidas a Cloudinary] -> Si falla la subida de cualquiera de los 3 archivos, el caso de uso aborta inmediatamente sin invocar la función RPC, manteniendo el módulo en `draft` o en su versión activa previa.
- [Filtración de secretos en cliente] -> El escáner `scripts/scan-client-secrets.mjs` y `scripts/scan-architecture.ts` vigilan que `CLOUDINARY_URL` e importaciones de Cloudinary nunca entren en la capa cliente o de dominio.
