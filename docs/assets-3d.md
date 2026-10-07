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

### Tabla de Dimensiones Corregidas v2

| Módulo | Referencia física aprobada | Escala uniforme | Bounding Box GLB v2 | Bounding Box USDZ v2 |
| :--- | :--- | :--- | :--- | :--- |
| **Mesa** (`mesa`) | Ancho **2.000m** | `0.145836` | **2.000m × 0.943m × 1.187m** | **2.000m × 1.187m × 0.943m** |
| **Arco** (`arco`) | Alto **2.400m** | `0.331813` | **2.445m × 2.400m × 0.505m** | **2.445m × 0.505m × 2.400m** |
| **Pista** (`pista`) | Ancho/profundidad **4.000m** | `0.569801` | **4.000m × 0.285m × 4.000m** | **4.000m × 4.000m × 0.285m** |

Las referencias físicas son la decisión de producto usada originalmente por el catálogo: mesa de 2m, arco de 2.4m y pista de 4m. Cada fuente v1 recibió una sola escala uniforme; ninguna proporción fue deformada. `scripts/reexport-scaled-glb.mjs` genera los GLB v2. `scripts/export-usdz-from-scaled-glb.py` genera los USDZ desde esos mismos GLB mediante Blender, garantizando geometría equivalente en Scene Viewer y Quick Look.

`scripts/inspect-glb-bounds.test.ts` fija los bounds v2. `scripts/validate-usdz-dimensions.py` reimporta cada USDZ con Blender y verifica las mismas dimensiones con el cambio esperado de ejes Y-up/Z-up. Los tres GLB pasan Khronos glTF Validator sin errores. Todos los archivos cumplen el máximo operativo de Cloudinary de 10 MiB; el arco GLB queda en 7.829 MiB y su USDZ móvil en 8.518 MiB.

`<model-viewer ar-scale="fixed">` impide el redimensionamiento por el usuario. Si una ficha de fabricante posterior cambia una referencia, se debe aplicar otra escala **uniforme** y publicar una versión nueva. No se publica una escala por eje. La validación geométrica automatizada no sustituye una prueba visual final en dispositivos Android/iOS.

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

### Activos corregidos (`v2`, activos)

| Módulo | GLB | USDZ | Poster |
| :--- | :--- | :--- | :--- |
| Mesa | `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791398022/decorar/mesa/v2/mesa.glb` | `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791398034/decorar/mesa/v2/mesa.usdz` | `https://res.cloudinary.com/gndjyjx2/image/upload/v1791398035/decorar/mesa/v2/mesa-poster.webp` |
| Arco | `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791398062/decorar/arco/v2/arco.glb` | `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791398757/decorar/arco/v2/arco.usdz` | `https://res.cloudinary.com/gndjyjx2/image/upload/v1791398758/decorar/arco/v2/arco-poster.webp` |
| Pista | `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791398785/decorar/pista/v2/pista.glb` | `https://res.cloudinary.com/gndjyjx2/raw/upload/v1791398788/decorar/pista/v2/pista.usdz` | `https://res.cloudinary.com/gndjyjx2/image/upload/v1791398789/decorar/pista/v2/pista-poster.webp` |

Las nueve URLs v2 respondieron HTTP 200 con MIME `model/gltf-binary`, `model/vnd.usdz+zip` o `image/webp`. Supabase conserva cada v1 como `retired` y exactamente una v2 `active` por `asset_id`.

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
