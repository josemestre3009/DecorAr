# Design

## Context

- Las dependencias DECOR-20, 21, 22, 23, 26, 28, 33, 37 y 38 están fusionadas.
- `e2e/package-configurator-live.spec.ts` (DECOR-22) ya prueba Builder, Composite, Prototype y presupuesto con usuarios efímeros contra `npm run dev`.
- `e2e/ar-viewer.spec.ts` (DECOR-23) prueba los atributos AR con un catálogo simulado.
- DECOR-39 exige:
  - Docker compose y Pixel 5;
  - seed idempotente con usuarios A/B;
  - `storageState`;
  - `data-testid` para AR.

## Goals / Non-Goals

**Goals:**
- Una sola orden ejecuta el flujo de demo completo contra la imagen Docker.
- Se puede repetir sin limpiar a mano.

**Non-Goals:**
- Abrir Scene Viewer o Quick Look; eso se evidencia manualmente.
- Activar el catálogo (DECOR-36).
- Integrar la suite en CI.

## Decisions

- **Configuración aparte (`playwright.mvp.config.ts`).** Se descartaron proyectos opt-in dentro de `playwright.config.ts`. Una configuración propia no cambia el dispositivo (Pixel 7) ni el `webServer` de las specs de DECOR-20/23 y deja explícito que esta suite no levanta servidor. La configuración existente solo añade `testIgnore` para no ejecutarla.
- **Usuarios A/B fijos, no efímeros.** El seed los crea o reajusta (contraseña y `email_confirm`) y borra únicamente sus paquetes. Se descartaron los usuarios por corrida (`createUser`/`deleteUser`): un teardown fallido deja usuarios huérfanos y eso no es un seed idempotente. Las cuentas son distintas de `DECOR_E2E_EMAIL` porque el logout de `auth.spec.ts` revoca su sesión.
- **El seed verifica, no activa, el catálogo.** Activar requiere Cloudinary y pertenece a DECOR-36. El seed falla con un mensaje que remite a `npm run catalog:publish-assets`.
- **Health estricto.** El setup exige el cuerpo `{"status":"ok"}`, no solo un 200. Así mitiga el hallazgo F4 de DECOR-37 (Playwright reutilizando otro servidor del puerto 3000).
- **Modo live comprobado.** El setup crea un paquete y exige la región "Tu espacio". En modo simulado falla y pide reconstruir con `NEXT_PUBLIC_DECOR_PACKAGES_API=live`.
- **Presupuesto.** `budget.recalculated` no transporta `packageVersion` (DECOR-21 F2). Por eso la prueba toma `GET /budget` como fuente de verdad y compara total y versión con la interfaz. La resincronización se provoca con `setOffline(true→false)`, que dispara el resync del evento `online`.
- **AR.** Android (Pixel 5) verifica GLB, `scene-viewer webxr`, escala fija y `ar-launch`. iPhone se verifica con el user agent de Safari (`ios-src` USDZ y `quick-look`), como en DECOR-23.

## Risks / Trade-offs

- **Hay datos persistentes en el alojado.** Son dos cuentas de prueba y sus paquetes de la última corrida, que se borran al empezar la siguiente.
- **La carga del GLB real depende de Cloudinary.** El tiempo de espera de `loaded` es mayor (45 s).
- **El total esperado depende de que el consumidor de Presupuesto (DECOR-33) esté desplegado en el alojado.** Si no lo está, la prueba lo informa con un mensaje explícito.
