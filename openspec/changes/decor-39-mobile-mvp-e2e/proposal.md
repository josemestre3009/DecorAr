# Proposal

## Why

DECOR-39 (Mei 6/6) pide un flujo móvil automatizado que demuestre la integración funcional del MVP: login, capacidad manual, catálogo, capacidad excedida, Composite, Prototype, presupuesto confirmado o resincronizado y la pantalla 3D/AR. Debe correr desde el host contra Docker compose, ser repetible y no requerir editar datos a mano. Cierra DECOR-9 y DECOR-12, que la usan como evidencia, y alimenta DECOR-18 y DECOR-19.

Hoy no existe una suite así:
- el único proyecto de Playwright es Pixel 7 y arranca `npm run dev`;
- no hay seed de usuarios A/B ni `storageState`;
- no hay artefactos al fallar.

## What Changes

- Añadir `scripts/seed-e2e.ts` (`npm run e2e:seed`). Es un seed idempotente server-side con `service_role`:
  - crea o reajusta los usuarios A y B;
  - borra solo sus paquetes;
  - verifica el catálogo activo (arco, mesa y pista), sin activarlo.
- Añadir `playwright.mvp.config.ts` (`npm run test:e2e:mvp`):
  - Pixel 5 y `baseURL` `http://127.0.0.1:3000`, sin servidor propio;
  - proyecto `mvp-setup` (health, seed y sesiones) como dependencia;
  - trace, captura y video al fallar.
- Añadir `e2e/mobile-mvp/` con el setup, helpers, el flujo (`mvp-flow.spec.ts`) y el acceso anónimo y del usuario B (`mvp-access.spec.ts`).
- Excluir `e2e/mobile-mvp/` de la configuración existente, que no cambia nada más. Ignorar `e2e/.auth/` y `blob-report/`.
- Documentar la ejecución en `docs/DecorAR.md` §2.2.9 y las variables en `.env.example`.

## Capabilities

### New Capabilities

- `mobile-mvp-e2e`: verificación automatizada y repetible del flujo de demo del MVP en un dispositivo móvil emulado.

### Modified Capabilities

Ninguna. No cambia código de producción, contratos de API, `compose.yaml` ni el `Dockerfile`.

## Impact

- Solo pruebas, scripts y documentación.
- Crea dos cuentas de prueba permanentes (A y B) en el Supabase alojado de pruebas.
- Requiere construir la imagen con `NEXT_PUBLIC_DECOR_PACKAGES_API=live`.
