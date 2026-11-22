# Proposal

## Why

Para validar la viabilidad técnica de la experiencia multiobjeto de DecorAR en WebXR antes de desarrollar la funcionalidad completa de diseño y persistencia de escenas (DECOR-46), se requiere una validación aislada y rigurosa en dispositivos físicos Android reales.

Este prototipo permite medir FPS sostenidos, consumo aproximado de memoria, estabilidad de tracking/hit-test y degradación en escenarios con 1, 5, 10 y 20 objetos 3D reales del catálogo a escala 1:1, utilizando una única sesión `immersive-ar` y reutilizando el patrón Flyweight del módulo AR.

## What Changes

- **Dominio AR (`src/modules/ar/domain`)**:
  - `escena-webxr.ts`: entidad pura e inmutable que gestiona la colocación, selección, movimiento, rotación de instancias (`InstanciaDecorativa`) y cálculo de rotación por gestos, con límite configurable de instancias y resultados tipados `Result<T, DomainError>`.
  - Pruebas unitarias completas en `escena-webxr.test.ts`.

- **Adaptador de presentación WebXR (`src/app/(protected)/packages/[packageId]/modules/[moduleId]/webxr-validation/`)**:
  - `page.tsx`: Server Component con protección de sesión (`requireSessionUser`).
  - `webxr-validation-view.tsx`: Client Component para la UI de validación, degradación amigable en navegadores sin WebXR hacia el visor 3D individual existente, selector de 1/5/10/20 objetos, y panel de diagnóstico en DOM overlay con opción de exportar métricas en JSON.
  - `webxr-validation-runtime.ts`: adaptador delgado de Three.js que gestiona la sesión `immersive-ar`, hit-test contra el suelo con retícula visual, ciclo de render con cálculo de FPS, lectura de `performance.memory` y liberación de recursos WebGL al desmontar.
  - Pruebas de integración del componente cliente en `webxr-validation-view.test.tsx`.

- **Pruebas End-to-End (`e2e/webxr-validation.spec.ts`)**:
  - Prueba de protección de sesión.
  - Prueba de degradación sin WebXR, viewport responsive en 360 px y foco visible.

- **Documentación y protocolo de pruebas (`docs/spikes/decor-45-webxr-results.md`)**:
  - Matriz vacía para pruebas en Android físico.
  - Guion de prueba de 60 segundos.
  - Reglas de decisión y guía de túnel HTTPS local.

## Capabilities

### New Capabilities
- `webxr-multiobject-validation`: ruta y visor de validación WebXR multiobjeto para pruebas de carga (1/5/10/20 objetos) con diagnósticos en vivo. Justificación de controles viables y evidencia: se implementan tanto la rotación por gesto multitáctil de dos puntos (con fallback accesible a botones +/-15°) como la exportación de diagnósticos en JSON estructurado para documentar con rigor los controles táctiles viables y recopilar evidencia cuantitativa reproducible durante las pruebas físicas en dispositivos Android reales.

### Modified Capabilities
Ninguna. El visor individual `<model-viewer>` existente permanece intacto.

## Impact

- No afecta a las tablas de la base de datos ni a los endpoints del catálogo.
- Dependencias utilizadas: `three` (ya existente en el proyecto).
- Respeta Clean Architecture: lógica de negocio en `src/modules/ar/domain`, infraestructura Three.js confinada a la capa de presentación cliente.
