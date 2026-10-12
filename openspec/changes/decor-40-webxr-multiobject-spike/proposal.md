# Proposal

## Why

El visor actual abre un único activo mediante `<model-viewer>` y no demuestra que una sesión WebXR propia pueda mantener varios objetos manipulables. Antes de construir un editor completo, DECOR-40 debe obtener evidencia reproducible en Android Chrome y Meta Quest sobre soporte, interacción y rendimiento reales.

## What Changes

- Añadir una ruta experimental protegida, separada del visor individual actual, que solicite una sesión `immersive-ar` con `hit-test` y `dom-overlay`.
- Cargar un GLB existente con Three.js, reutilizar su geometría y materiales, y permitir colocar varios clones hasta un límite configurable por la prueba.
- Permitir seleccionar, recolocar y girar objetos; probar interacción táctil/XR directa y ofrecer botones de giro de 15 grados como respaldo cuando el gesto de dos puntos no sea estable.
- Mostrar un panel diagnóstico local con capacidades, eventos observados, objetos activos y métricas de rendimiento útiles para la prueba.
- Ejecutar una matriz manual en al menos dos fabricantes Android y Meta Quest, documentando versión, resultado, evidencia, limitaciones y recomendación final.
- Mantener posiciones únicamente en memoria durante la sesión, escala fija 1:1 y ausencia de sombras dinámicas.
- No modificar el visor individual, contratos de catálogo, base de datos, migraciones ni endpoints de escritura.

## Capabilities

### New Capabilities

- `webxr-multiobject-spike`: prototipo y protocolo de validación para colocar y manipular varios objetos en una sesión WebXR AR.

### Modified Capabilities

Ninguna.

## Impact

- Añade una ruta y componentes cliente experimentales bajo el área protegida de paquetes, además de tipos WebXR mínimos y pruebas automatizables de la lógica independiente del dispositivo.
- Reutiliza `three` 0.183, ya instalado; puede requerir tipos TypeScript compatibles, sin añadir runtime adicional.
- Reutiliza URLs HTTPS de GLB del catálogo. No cambia `src/modules/ar` ni `model-viewer-client.tsx`, salvo un enlace de acceso experimental si resulta necesario.
- La validación final depende de HTTPS y dispositivos físicos; Playwright/jsdom solo cubren estados, límites y degradación, no certifican soporte WebXR.
