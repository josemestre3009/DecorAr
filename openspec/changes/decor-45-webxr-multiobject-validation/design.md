# Design

## Context

DECOR-45 es un prototipo experimental separado cuyo propósito es validar la viabilidad técnica y el rendimiento de WebXR multiobjeto en dispositivos Android reales con ARCore antes de abordar la persistencia de posiciones (DECOR-46). Se requiere probar escenas con 1, 5, 10 y 20 objetos 3D del catálogo a escala real 1:1, midiendo FPS, memoria estimada y estabilidad de hit-test.

## Goals / Non-Goals

**Goals:**
- Prototipo separado e independiente sin alterar el visor individual model-viewer existente.
- Lógica de dominio pura e inmutable en `src/modules/ar/domain/escena-webxr.ts` con límite configurable de instancias y retorno de `Result/DomainError`.
- Reutilización del patrón Flyweight existente (`FabricaActivos3D`, `Activo3DCompartido`, `InstanciaDecorativa`).
- Detección de superficie mediante WebXR hit-test en sesión `immersive-ar` única con retícula visual.
- Selector de cantidad objetivo (1, 5, 10, 20 objetos) que distribuye los modelos GLB disponibles en el catálogo.
- Panel DOM overlay con métricas en tiempo real: FPS promedio, memoria (`performance.memory`), fallos y recuento de objetos, con botón de exportación a JSON.
- Degradación elegante para dispositivos o navegadores sin soporte WebXR hacia el visor 3D existente.
- Liberación estricta de memoria (geometrías, texturas, sesión XR) al salir de la vista.

**Non-Goals:**
- Persistencia de posiciones y transformaciones (alcance de DECOR-46).
- Eliminación individual de objetos o herramientas completas de edición de escena.
- Modificaciones en `<model-viewer>` o en el visor individual.

## Decisions

### 1. Dominio inmutable en `src/modules/ar/domain/escena-webxr.ts`
La manipulación de la escena (colocar, seleccionar, mover, rotar y resetear) se modela de manera funcional e inmutable. Cada operación produce una nueva referencia de `EscenaWebXR` congelada con `Object.freeze`. El límite de instancias es un parámetro configurable (por defecto 20). No tiene dependencias de React, Next.js, Three.js ni Supabase, cumpliendo con las reglas arquitectónicas del repositorio.

### 2. Flyweight para modelos Three.js
En el runtime de Three.js (`webxr-validation-runtime.ts`), cada activo 3D se descarga una única vez a través de `GLTFLoader` usando la clave `assetId@vN` de `Activo3DCompartido`. Al colocar múltiples objetos en la escena, se clona el árbol de Three.js (`scene.clone(true)`), compartiendo buffers y minimizando la memoria de GPU.

### 3. Distribución para pruebas de carga (1, 5, 10, 20 objetos)
El runtime implementa `populateTarget(count)`. Exige estrictamente que la retícula de hit-test esté visible sobre el piso; si no lo está, emite un aviso en el panel y no puebla. Al poblar, el primer objeto se coloca exactamente en el centro de la retícula detectada y el resto se distribuye en círculo concéntrico a su alrededor, alternando los modelos GLB disponibles mediante el Flyweight. Inmediatamente tras poblar, se deseleccionan las instancias para que tocar de nuevo la retícula añada un objeto nuevo en lugar de desplazar los ya colocados.

### 4. Diagnóstico y métricas en vivo
El overlay en DOM muestra FPS calculados por ventana temporal de 1 segundo, uso de memoria JS heap si `performance.memory` está presente (Chrome/Android), y estado de eventos. Permite copiar el reporte estructurado en formato JSON para facilitar la recolección de evidencia en pruebas físicas.

### 6. Ubicación del adaptador Three.js y tensión con la arquitectura
Las reglas de negocio (`evaluarEscalaReal`, `calcularPosicionesDisposicion`, `resetearEscena`) viven en el dominio. El runtime se divide en `webxr-validation-{models,metrics,session,runtime}.ts`.

Three.js permanece, por decisión del spike, en la capa de presentación cliente de la ruta, porque `scripts/scan-architecture.ts` prohíbe que los componentes `'use client'` importen `infrastructure` (excepto `supabase/browser`). Esto choca con el README de `ar`, que describe `infrastructure` como "integración con plataformas AR": el lugar natural del adaptador sería `src/modules/ar/infrastructure`.

**Propuesta para DECOR-48** (a discutir con Jose; no se aplica aquí): reubicar el adaptador en `src/modules/ar/infrastructure` con un puerto en el dominio/aplicación y añadir una excepción acotada en el scan. No se modifica `scripts/scan-architecture.ts` en este cambio.

### 5. Limpieza rigurosa de recursos WebGL
Al terminar la sesión XR o desmontar el componente, el runtime cancela el hit-test, detiene el animation loop, recorre y destruye geometrías y materiales (`geometry.dispose()`, `material.dispose()`), remueve el canvas del DOM y finaliza la sesión XR.
