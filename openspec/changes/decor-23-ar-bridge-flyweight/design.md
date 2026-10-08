# Design

## Context

`docs/DecorAR.md` define la AR del MVP: detectar una superficie compatible y colocar, mover y rotar un elemento a escala 1:1 con `<model-viewer>`, que abre Quick Look en iOS, Scene Viewer o WebXR en Android. Queda fuera escanear la habitación, medirla, detectar obstáculos o distribuir elementos.

El catálogo (`GET /api/modules`) ya expone `assetId`, `version`, `glbUrl`, `usdzUrl`, `posterUrl` y dimensiones en metros. DECOR-36 publicó la v2 de mesa (2 × 0,94 × 1,19 m), arco (2,45 × 2,4 × 0,51 m) y pista (4 × 0,29 × 4 m) en Cloudinary; las nueve URLs responden con el MIME correcto y `Access-Control-Allow-Origin: *`.

`scripts/scan-architecture.ts` impide que un componente cliente importe infraestructura y que el dominio importe React o Next.

## Goals / Non-Goals

**Goals:**

- Bridge y Flyweight implementados en código, observables desde la UI y con pruebas.
- Vista 3D de los tres módulos con lanzamiento AR a escala fija sobre el piso.
- USDZ obligatorio en iOS; GLB en Android y web.
- Estados de carga, progreso, error, reintento e incompatibilidad.
- Atributos AR verificables en el DOM para la E2E de DECOR-39.

**Non-Goals:**

- Escaneo, medición, obstáculos o auto-layout.
- Endpoint de módulo por id (DECOR-28 es dueño del contrato).
- Persistir posición o rotación de instancias: el paquete sigue simulado hasta DECOR-27.

## Decisions

### El Bridge produce configuración, `<model-viewer>` la ejecuta

Cada `RenderizadorAR` devuelve un objeto plano (`src`, `iosSrc`, `arModes`, `arPlacement`, `arScale`, `poster`, `alt`, `descargas`) en lugar de abrir el visor por su cuenta. Así el dominio queda puro y probable sin dispositivo, y el lanzamiento nativo lo hace `<model-viewer>`, que la tarea exige.

Alternativa descartada: renderizadores que construyen la URL `intent://` de Scene Viewer o el enlace `rel="ar"` de Quick Look. Duplican lo que ya hace `<model-viewer>`, requieren vivir en infraestructura (que un componente cliente no puede importar) y aumentan el mantenimiento por plataforma.

### Bridge y Flyweight viven en `ar/domain`

Son TypeScript puro y el componente cliente puede importarlos sin violar `client-server-import`. `PrepararVistaARUseCase` (aplicación) los une. El módulo AR no importa el de catálogo: `ModuloParaAR` coincide por estructura con `CatalogModuleDto`.

### Selección del renderizador

Orden: Quick Look (iOS, incluido iPadOS que se anuncia como Mac táctil), Scene Viewer (Android, con WebXR como respaldo en `ar-modes`), WebXR (otros navegadores con `immersive-ar`) y sin AR. La detección es una preferencia: `<model-viewer>` vuelve a comprobar `canActivateAR` y la vista avisa si no puede abrir AR.

### Colocación sobre el piso

Mesa, arco y pista se apoyan en el piso (`ar-placement="floor"`). El arco es una estructura de pie de 2,4 m, no un elemento de pared. El tipo `ColocacionAR` admite `wall` para módulos futuros.

### Flyweight por `assetId@vN` y una fábrica por pestaña

`FabricaActivos3D` congela el activo (`Object.freeze`) y lo reutiliza por clave. Si llegan datos distintos con la misma clave responde `ar.asset_conflict` en lugar de sobrescribir, coherente con la inmutabilidad de versiones de DECOR-36. `_lib/ar-view.ts` mantiene una fábrica por pestaña. `InstanciaDecorativa` es inmutable: mover, rotar o colorear devuelve otra instancia con el mismo activo. La escala es siempre 1.

### Atributos aplicados con `setAttribute`

Cuando `<model-viewer>` ya está registrado, React 19 asigna `src`, `alt`, `poster`, `ar`, `loading` y `reveal` como propiedades, que no quedan en el DOM. La E2E lo detectó. El componente los escribe con `setAttribute` en un ref callback, que además registra los eventos al montar el elemento para no perder un `load` inmediato.

### La disponibilidad de AR la confirma `<model-viewer>`

La detección propia elige el renderizador, pero el botón "Ver en tu espacio" solo aparece si `<model-viewer>` confirma `canActivateAR`. En iPhone, Quick Look solo funciona en Safari o en Chrome, Edge y Firefox de iOS; dentro de WhatsApp, Instagram o la app de Google responde que no. La vista lee `canActivateAR` al cargar y de nuevo a los 300 ms y 1,5 s, porque el modo AR se decide de forma asíncrona. Los pasos para colocar el modelo solo se muestran cuando el botón existe; si no, el aviso explica qué navegador usar.

### Carga solo en el navegador

`@google/model-viewer` usa `window` y WebGL. Se importa con `import()` dentro de un efecto del componente cliente (guía "Lazy Loading" de Next.js 16). Si la librería falla, la vista muestra el error y "Reintentar".

### Validación de los campos 3D en el dominio

`fetchCatalogModules` conserva su validación: endurecerla vaciaría toda la grilla por una fila. `crearActivo3DCompartido` exige URLs HTTPS absolutas y dimensiones finitas mayores que 0, y la vista explica el motivo si un módulo no se puede abrir.

## Risks / Trade-offs

- La E2E corre en Chromium y no abre visores nativos. Colocar, mover y rotar en una superficie real se evidencia manualmente en Android y en un iPhone.
- Los USDZ v2 no se habían probado en un iPhone físico (DECOR-36).
- `@google/model-viewer` y `three` aumentan el JavaScript de la vista 3D. Se cargan solo en esa ruta.
- Después del login la app siempre vuelve a `/packages`; un enlace directo a la vista 3D no regresa a ella (comportamiento de DECOR-38).

## Migration Plan

No hay migraciones. Al fusionar, la vista usa los módulos `active` del catálogo. Rollback: revertir el merge.
