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
* **Idempotencia y recuperación (F1):** Si un activo ya fue subido previamente en un intento parcial, Cloudinary retorna `{ existing: true }` o conflicto. El adaptador `CloudinaryAssetStorage` captura esta condición y consulta `cloudinary.api.resource(publicId)` para recuperar de manera segura su `secure_url` y tamaño en bytes, permitiendo que la reejecución sea 100% idempotente y no bloqueante.

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

### Tabla de Medición y Calibración de Catálogo

| Módulo | Archivo GLB | Tamaño GLB | Bounding Box Geométrico (Vértices) | Dimensiones Catálogo (AR 1:1 Fija) | Área ($m^2$) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Mesa** (`mesa`) | `mahogany_table.glb` | 9.36 MB | Ancho: 13.71m, Alto: 6.46m, Prof: 8.14m | **2.0m × 1.0m × 2.0m** | 4.0 |
| **Arco** (`arco`) | `flower_arch.glb` | 9.75 MB | Ancho: 7.37m, Alto: 7.23m, Prof: 1.52m | **2.0m × 2.4m × 1.0m** | 2.0 |
| **Pista** (`pista`) | `animated_dance_floor_neon_lights.glb` | 2.51 MB | Ancho: 7.02m, Alto: 0.50m, Prof: 7.02m | **4.0m × 0.1m × 4.0m** | 16.0 |

> **Nota sobre autoría y calibración:** Los modelos de autoría original presentan transformaciones de coordenadas y unidades libres (ej. rotación de -90° en X o cuantización `KHR_mesh_quantization`). Las dimensiones del catálogo registradas en Supabase (`width_m`, `height_m`, `depth_m`) corresponden a la calibración física 1:1 asignada al módulo en el espacio de eventos.

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
   npx tsx scripts/inspect-glb-bounds.ts
   ```
3. **Crear fila en estado Draft en la Base de Datos:**
   Registrar mediante migración SQL o script administrativo la fila con `status = 'draft'` y `version = 2`.
4. **Ejecutar publicación:**
   Ejecutar el script de publicación:
   ```bash
   npm run catalog:publish-assets
   ```
5. **Verificación:**
   El caso de uso subirá los archivos a `decorar/{assetId}/v2/...` e invocará la RPC para activar atómicamente la versión 2, conservando intacta la versión 1 anterior.
