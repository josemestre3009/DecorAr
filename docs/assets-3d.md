# Pipeline y Gestión de Activos 3D (DECOR-36)

Este documento detalla la arquitectura, directrices operativas, especificaciones técnicas y evidencia de validación de los activos 3D del catálogo de **DecorAR**, conforme a las decisiones de diseño de `docs/DecorAR.md` y los requerimientos del work item **DECOR-36**.

---

## 1. Arquitectura de Almacenamiento

### 1.1. Principio Server-Only y Clean Architecture
* El almacenamiento de activos 3D se realiza en **Cloudinary**.
* La variable `CLOUDINARY_URL` reside de forma estrictamente confidencial en el servidor (`.env`) y se accede exclusivamente mediante `getCloudinaryEnv()` en `src/lib/env.ts`.
* El cliente web y la capa de dominio (`src/modules/catalog/domain/`) desconocen por completo a Cloudinary:
  - **Puerto de Aplicación:** `AssetStoragePort` (`src/modules/catalog/application/ports/asset-storage.port.ts`) define un contrato agnóstico con `destinationPath`, tipo de contenido y política de idempotencia (`ifExists: "reuse"`).
  - **Adaptador de Infraestructura:** `CloudinaryAssetStorage` (`src/modules/catalog/infrastructure/cloudinary-asset-storage.ts`) con la directiva `"server-only"` traduce las operaciones al SDK de Cloudinary.
  - **Escáneres estáticos:** `scripts/scan-architecture.ts` y `scripts/scan-client-secrets.mjs` validan en CI que `CLOUDINARY_URL` e importaciones de Cloudinary nunca entren al cliente o al dominio.

### 1.2. Estructura de Identificadores y Versionado Inmutable
* Los identificadores públicos (`public_id`) en Cloudinary siguen un formato jerárquico determinista:
  $$\text{decorar}/\{\text{assetId}\}/\text{v}\{\text{version}\}/\{\text{filename}\}$$
* **Configuración inmutable:** Las subidas se ejecutan con `overwrite: false`.
* **Idempotencia y recuperación (F1):** Si un activo ya fue subido durante un intento parcial que conserva la fila en `draft`, Cloudinary retorna `{ existing: true }` o conflicto. El adaptador recupera su `secure_url` y tamaño mediante `cloudinary.api.resource(publicId)`, permitiendo reintentar esa publicación sin sobrescribir. Una versión ya `active` no se reejecuta: la RPC la rechaza para conservar su inmutabilidad.

---

## 2. Especificación Técnica de los Modelos del MVP

El MVP exige 3 módulos base con 3 archivos cada uno (total 9 activos):
1. **GLB:** Formato binario glTF 2.0 (`resource_type: "raw"`, MIME `model/gltf-binary`) para renderizado web y Android Scene Viewer.
2. **USDZ:** Formato empaquetado para iOS (`resource_type: "raw"`, MIME `model/vnd.usdz+zip`) obligatorio para AR Quick Look.
3. **Poster:** Imagen optimizada (`resource_type: "image"`, formato `.webp`/`.png`/`.jpg`, MIME `image/webp`) para placeholder visual antes de cargar el 3D.

### Límites de Tamaño y Rendimiento
* **Modelos 3D (GLB y USDZ):** Máximo estricto de **15 MB** (objetivo de optimización $< 10\text{ MB}$).
* **Posters:** Máximo estricto de **1 MB** (objetivo de optimización $< 300\text{ KB}$).

---

## 3. Dimensiones Reales 1:1 y Medición Geométrica (F3)

Para la colocación en Realidad Aumentada, la visualización debe mantenerse a escala real 1:1 (`ar-scale="fixed"` en `<model-viewer>`).

Para validar matemáticamente las dimensiones, el repositorio incluye la herramienta `scripts/inspect-glb-bounds.ts`, la cual procesa la cabecera binaria glTF de 12 bytes y el grafo de nodos/transformaciones para extraer el Bounding Box transformado de la escena:

### Tabla de Dimensiones Nativas Publicadas

| Módulo | Archivo GLB | Bounding Box nativo y dimensiones de catálogo |
| :--- | :--- | :--- |
| **Mesa** (`mesa`) | `mahogany_table.glb` | **13.714m × 6.463m × 8.139m** |
| **Arco** (`arco`) | `flower_arch.glb` | **7.369m × 7.233m × 1.521m** |
| **Pista** (`pista`) | `animated_dance_floor_neon_lights.glb` | **7.020m × 0.500m × 7.020m** |

glTF 2.0 usa metros como unidad lineal ([Khronos glTF 2.0, Coordinate System and Units](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)). El publicador persiste directamente este Bounding Box: no recibe dimensiones manuales ni calcula factores desde un tamaño esperado. Esto elimina la prueba circular y evita deformar el modelo. `<model-viewer ar-scale="fixed">` impide el redimensionamiento por el usuario, pero no corrige un archivo mal escalado; además, Scene Viewer descarga el GLB original y no conserva transformaciones del DOM ([model-viewer, Model Transformations](https://modelviewer.dev/examples/scenegraph/)).

La tabla conserva la medición a tres decimales; `catalog_modules` usa `NUMERIC(10,2)` y expone los valores redondeados a centímetros.

Si una ficha de fabricante aporta otro tamaño real, se debe aplicar una escala **uniforme** y reexportar tanto GLB como USDZ bajo una versión nueva. No se publica una escala por eje. Los USDZ v1 son paquetes válidos generados desde los mismos activos, pero no se dispone aquí de una prueba física en un dispositivo iOS; no se afirma esa validación manual.

---

## 4. Activación Atómica e Inmutabilidad en Supabase (F2)

La activación en base de datos la gestiona la función RPC PostgreSQL `public.activate_catalog_module`:
* **Firma de seguridad:** `SECURITY INVOKER` y `SET search_path = ''`.
* **Bloqueo pesimista:** Ejecuta `SELECT ... FOR UPDATE` sobre la fila del módulo para evitar condiciones de carrera.
* **Inmutabilidad estricta:** Valida que el registro se encuentre en `status = 'draft'`. Si el módulo ya se encuentra en estado `'active'`, la función arroja la excepción:
  ```sql
  RAISE EXCEPTION 'Catalog module with asset_id % and version % is not in draft status (current status: %)', ...
  ```
  Esto previene que una versión ya publicada sea sobreescrita o alterada silenciosamente.

---

## 5. URLs de Activos Publicados (Evidencia HTTP 200)

Los 9 activos correspondientes a la versión `v1` se encuentran publicados y verificados en producción:

### Módulo: Mesa (`mesa` v1)
* **GLB:** `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791304400/decorar/mesa/v1/mesa.glb`
* **USDZ:** `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791304402/decorar/mesa/v1/mesa.usdz`
* **Poster:** `https://res.cloudinary.com/gndjyjx2/image/upload/v1791304403/decorar/mesa/v1/mesa-poster.webp`

### Módulo: Arco (`arco` v1)
* **GLB:** `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791304570/decorar/arco/v1/arco.glb`
* **USDZ:** `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791304571/decorar/arco/v1/arco.usdz`
* **Poster:** `https://res.cloudinary.com/gndjyjx2/image/upload/v1791304572/decorar/arco/v1/arco-poster.webp`

### Módulo: Pista (`pista` v1)
* **GLB:** `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791304573/decorar/pista/v1/pista.glb`
* **USDZ:** `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791304574/decorar/pista/v1/pista.usdz`
* **Poster:** `https://res.cloudinary.com/gndjyjx2/image/upload/v1791304574/decorar/pista/v1/pista-poster.webp`

---

## 6. Procedimiento Operativo: Publicación de una Nueva Versión (v2)

Para actualizar o crear una nueva versión de un activo sin afectar la versión activa:
1. **Crear carpeta de versión:**
   Colocar los archivos optimizados bajo `assets/3d/{assetId}/v2/` (`{assetId}.glb`, `{assetId}.usdz`, `poster.{webp|png|jpg}`).
2. **Inspeccionar límites y bounding box:**
   Ejecutar la herramienta de medición:
   ```bash
   npx tsx scripts/inspect-glb-bounds.ts --asset=mesa --version=2
   ```
3. **Crear fila en estado Draft en la Base de Datos:**
   Registrar mediante migración SQL o script administrativo la fila con `status = 'draft'` y `version = 2`.
4. **Ejecutar publicación:**
   Ejecutar el script de publicación:
   ```bash
   npm run catalog:publish-assets -- --asset=mesa --version=2
   ```
5. **Verificación:**
   El caso de uso subirá los archivos a `decorar/{assetId}/v2/...`. La RPC serializa por `asset_id`, cambia v1 de `active` a `retired` y activa v2 en la misma transacción. El índice `uq_catalog_modules_one_active_asset` impide dos versiones activas.

## 7. Recuperación, limpieza y rollback

* **Fallo antes de activar:** conservar la fila `draft` y reejecutar el mismo comando. La política `ifExists: "reuse"` recupera los archivos ya cargados sin sobrescribirlos.
* **Abandono de una versión draft:** confirmar primero que ninguna fila `active` referencia sus URLs. Luego eliminar únicamente los tres `public_id` de esa versión en Cloudinary y eliminar o cancelar la fila `draft` mediante una migración o script administrativo revisado.
* **Rollback de una versión activa:** una fila publicada es inmutable. No se edita ni se borra. Crear una versión nueva en `draft` con los activos previamente validados y publicarla; la RPC sustituye la versión vigente atómicamente.
* **Fallo después de activar:** no borrar activos. La RPC ya confirmó referencias activas; cualquier corrección se publica como versión nueva.

Nunca usar `overwrite:true` ni borrar una carpeta completa: otras versiones pueden seguir activas.
