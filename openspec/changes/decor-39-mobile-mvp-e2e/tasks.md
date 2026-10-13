# Tasks

## 1. Datos y configuración

- [x] 1.1 `scripts/seed-e2e.ts` idempotente (usuarios A/B, paquetes de A/B, verificación de catálogo) y `scripts/seed-e2e.test.ts`.
- [x] 1.2 `playwright.mvp.config.ts` (Pixel 5, `127.0.0.1:3000`, trace/captura/video al fallar) y `testIgnore` en `playwright.config.ts`.
- [x] 1.3 Scripts `e2e:seed` y `test:e2e:mvp`; `.gitignore` y `.env.example`.

## 2. Pruebas

- [x] 2.1 `e2e/mobile-mvp/mvp.setup.ts`: health, seed, `storageState` de A y B, modo live.
- [x] 2.2 `mvp-flow.spec.ts`: happy path, capacidad excedida, Composite, presupuesto confirmado, resincronización, Prototype, AR Android e iOS.
- [x] 2.3 `mvp-access.spec.ts`: anónimo bloqueado y usuario B con 404.

## 3. Revisión de Jose (PR #24)

- [x] 3.1 F1: marca `app_metadata.decor_e2e_seed` y rechazo, antes de escribir, de cuentas existentes sin la marca; pruebas unitarias sin escrituras.
- [x] 3.2 F2: capacidad excedida con dos contextos sobre el mismo paquete (vista obsoleta), 422 y sin mutación de la interfaz.
- [x] 3.3 Fusionar `main` actual (DECOR-41, DECOR-42 y rediseño visual).

## 4. Verificación

- [x] 4.1 `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- [x] 4.2 `npm run test:e2e:mvp` en verde contra Docker en modo live, dos veces seguidas.
- [x] 4.3 Artefactos de fallo (trace, captura y video) comprobados con un fallo real de la primera corrida (resincronización), ya corregido.
- [x] 4.4 Evidencia manual de AR en Android (Scene Viewer) e iPhone (Quick Look).
- [x] 4.5 Ejecutar `openspec validate decor-39-mobile-mvp-e2e --type change --strict`. Válido (`npx @fission-ai/openspec@1.14.1`, telemetría desactivada).
