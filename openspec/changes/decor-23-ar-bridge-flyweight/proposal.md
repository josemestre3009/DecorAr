# Proposal

## Why

Con el catálogo de DECOR-28 y los activos v2 de DECOR-36 publicados (GLB, USDZ y poster con dimensiones reales), falta la experiencia que justifica DecorAR: ver un módulo en 3D y colocarlo en el espacio real a escala 1:1 (`docs/DecorAR.md` §1.3). La tarea además debe evidenciar en código dos patrones estructurales de la arquitectura aprobada: Bridge (§4.4), para separar el elemento decorativo de la plataforma AR, y Flyweight (§4.5), para compartir el activo 3D entre instancias.

## What Changes

- Módulo `src/modules/ar` con dominio puro (sin React ni Next):
  - Flyweight: `Activo3DCompartido` inmutable, `FabricaActivos3D` con caché por `assetId`+`version` e `InstanciaDecorativa` con el estado propio de cada copia.
  - Bridge: `ElementoAR` con `MesaAR`, `ArcoAR` y `PistaAR`; `RenderizadorAR` con `RenderizadorQuickLook`, `RenderizadorSceneViewer`, `RenderizadorWebXR` y `RenderizadorSinAR`, más `elegirRenderizador`.
  - Caso de uso `PrepararVistaARUseCase`, que une ambos patrones y devuelve la configuración del visor.
- Nueva página protegida `/packages/[packageId]/modules/[moduleId]` con la vista 3D, y enlace "Ver en 3D" en cada tarjeta del catálogo.
- Componente cliente que carga `@google/model-viewer` solo en el navegador, con poster, carga diferida, controles de cámara, progreso, error y reintento, aviso de incompatibilidad con descarga GLB/USDZ y selectores `data-testid` para la E2E de DECOR-39.
- Detección de plataforma (iOS, incluido iPadOS; Android; WebXR) en `_lib/ar-capabilities.ts`.
- `fetchCatalogModule(id)` en `_lib/catalog-client.ts`.
- Pruebas unitarias, de componentes y E2E (`e2e/ar-viewer.spec.ts`).

## Capabilities

### New Capabilities

- `ar-module-viewer`: vista 3D y lanzamiento AR de un módulo del catálogo a escala fija, con Bridge y Flyweight.

### Modified Capabilities

Ninguna. El enlace "Ver en 3D" de la tarjeta (DECOR-20) se especifica dentro de `ar-module-viewer`, porque `mobile-entry-catalog` aún no está archivada.

## Impact

- Añade código en `src/modules/ar/`, `src/app/(protected)/packages/[packageId]/modules/[moduleId]/`, `src/app/(protected)/packages/_lib/` y `src/types/model-viewer.d.ts`.
- Modifica `module-card.tsx`, `package-catalog.tsx`, `catalog-client.ts` (y sus pruebas), `globals.css`, `docs/DecorAR.md` y `src/modules/ar/README.md`.
- Añade las dependencias `@google/model-viewer` (exigida por la tarea) y `three`, su dependencia par. `npm audit --omit=dev` no reporta vulnerabilidades nuevas por ellas.
- No modifica `GET /api/modules` (DECOR-28), los activos ni la base de datos (DECOR-36), ni el proxy o la sesión (DECOR-38).
