# Tasks

## 1. Dominio puro AR (`src/modules/ar/domain`)

- [x] 1.1 Crear `escena-webxr.ts` con tipos e inmutabilidad (`crearEscenaWebXR`, `colocarEnEscena`, `seleccionarEnEscena`, `deseleccionarEnEscena`, `moverSeleccionado`, `rotarSeleccionado`, `calcularRotacionGesto`, `resetearEscena`) y límite configurable de instancias con `Result/DomainError`. `resetearEscena` ahora devuelve `Result`.
- [x] 1.2 Crear suite de pruebas de dominio `escena-webxr.test.ts` cubriendo inmutabilidad, límite configurable, selección, traslación y rotación.
- [x] 1.3 Verificar cumplimiento de límites arquitectónicos con `scripts/scan-architecture.test.ts`. Evidencia: ejecutado, en verde.
- [x] 1.4 Mover reglas de negocio al dominio: `evaluarEscalaReal`, `calcularPosicionesDisposicion` y `resetearEscena` (con `Result`).

## 2. Adaptador y Presentación WebXR (`src/app/(protected)/packages/[packageId]/modules/[moduleId]/webxr-validation/`)

- [x] 2.1 Crear el runtime con Three.js, dividido en `webxr-validation-models.ts`, `webxr-validation-metrics.ts`, `webxr-validation-session.ts` y `webxr-validation-runtime.ts`: sesión única `immersive-ar`, hit-test del piso con retícula visual, distribución de 1/5/10/20 objetos con Flyweight, cálculo de FPS, lectura de memoria (`performance.memory`), exportación JSON y liberación de recursos WebGL (`dispose`).
- [x] 2.2 Crear `webxr-validation-view.tsx` con manejo de estados de sesión, degradación amigable sin WebXR hacia el visor 3D individual, controles interactivos, selector de cantidad objetivo y panel de diagnósticos en DOM overlay (incluye User Agent y comprobación `isSecureContext`).
- [x] 2.3 Crear `page.tsx` protegido con `requireSessionUser()`.
- [x] 2.4 Agregar estilos responsivos para el selector y panel de diagnóstico en `src/app/globals.css`.
- [x] 2.5 Crear pruebas unitarias y de degradación en `webxr-validation-view.test.tsx` y pruebas de ciclo de vida del runtime con WebGL/WebXR simulado en `webxr-validation-runtime.test.ts`.
- [x] 2.6 Correcciones del adaptador: eliminar `renderer.xr.setSession(null)` (no cierra la sesión; el cierre es `session.end()` + evento `end`), añadir `beforexrselect`, flag `ended` contra cargas en vuelo, `onEnd(failed)` y aviso al alcanzar el límite.
- [x] 2.7 Añadir `@types/three` (^0.183.1) y `@types/webxr` (^0.5.24) como dependencias de desarrollo (solo tipos, necesarias para `typecheck`). No se añaden IWER ni otras.
- [ ] 2.8 Alcance extra (decisión de Rafael, a decidir por Jose en el PR): gesto de dos dedos y botón Reiniciar, no incluidos en el guion del ticket. No se dan por validados en dispositivo real.
- [ ] 2.9 Reubicar el adaptador Three.js en `src/modules/ar/infrastructure` con puerto, previa discusión con Jose en DECOR-48 (ver `design.md`, decisión 6). No se modifica `scripts/scan-architecture.ts` en este cambio.

## 3. Pruebas E2E (`e2e/webxr-validation.spec.ts`)

- [x] 3.1 Crear test Playwright que verifica protección de sesión, degradación en navegador sin WebXR, ajuste a viewport de 360 px y foco visible. (Archivo creado; ver 3.2 para su ejecución.)
- [ ] 3.2 Ejecutar `e2e/webxr-validation.spec.ts`. `npx playwright install chromium` falla (descarga desde cdn.playwright.dev); se usa la config local no versionada `playwright.local.config.ts` (`channel: "chrome"`): `npx playwright test e2e/webxr-validation.spec.ts -c playwright.local.config.ts`. Estado (2026-11-22): 1 de 2 tests ejecutados y verdes con Chrome local; el 2º ('degrada sin WebXR, cabe a 360 px y conserva foco visible') bloqueado por credenciales E2E (HTTP 400 en login de Supabase; `e2e/auth.spec.ts` falla igual).
  - [ ] 3.2.1 Proveer una cuenta E2E válida en `DECOR_E2E_EMAIL`/`DECOR_E2E_PASSWORD` y reejecutar el comando anterior.

## 4. Verificación, documentación y protocolo de resultados

- [x] 4.0 Verificaciones automatizadas ejecutadas y en verde:
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run`: suite completa antes de los últimos cambios, 145 archivos / 1307 tests; tras ellos, ejecución dirigida de 13 archivos / 205 tests.
  - `npm run build`
  - `scripts/scan-architecture.test.ts`
- [x] 4.1 Crear especificación en `openspec/changes/decor-45-webxr-multiobject-validation/specs/webxr-multiobject-validation/spec.md`.
- [x] 4.2 Crear `docs/spikes/decor-45-webxr-results.md` con matriz vacía de dispositivos, guion de prueba de 60 s, reglas de decisión e instrucciones de túnel HTTPS con Cloudflare Tunnel; ampliado con dispositivo descartado y método de medición.
- [ ] 4.3 Ejecución de pruebas físicas en dispositivos Android reales con ARCore (1/5/10/20 objetos, FPS, memoria, hit-test) y registro de métricas en la matriz. **BLOQUEADO**: el POCO X6 Pro de Rafael no figura en la lista oficial de ARCore y no hay otro dispositivo compatible disponible. Emuladores, granjas e IWER solo validan ciclo de vida, no FPS/memoria/hit-test reales.
- [ ] 4.4 Decisión técnica final (continuar / recortar / solo 3D) sobre la viabilidad de WebXR multiobjeto para DECOR-46. **BLOQUEADO** por 4.3.
- [ ] 4.5 Adjuntar evidencia en Plane (capturas/video + tabla de la matriz) cuando exista 4.3.
- [x] 4.6 Comentar en Plane el estado actual y el bloqueo (dispositivo no compatible con ARCore, E2E pendiente de instalar chromium). Publicado el 2026-11-21 con estado Blocked.
- [ ] 4.7 Verificar si algún modelo del catálogo lleva huesos (`SkinnedMesh`); si es así, usar `SkeletonUtils.clone` en lugar de `clone(true)`. Riesgo abierto, no verificable desde el repo.
- [ ] 4.8 Comprobar que los GLB de Cloudinary respondan con CORS.
