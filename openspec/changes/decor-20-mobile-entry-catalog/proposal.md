# Proposal

## Why

Con la sesión SSR de DECOR-38 y el catálogo de DECOR-28 ya integrados, falta el primer recorrido funcional del cliente móvil: una persona autenticada debe poder definir su espacio, crear su paquete y consultar el catálogo para empezar a armarlo. Todo ese recorrido debe pasar por las APIs de Next.js, sin CRUD de negocio desde el navegador contra PostgREST (`docs/DecorAR.md` §2.2.1).

La API de paquetes (`POST /api/packages` y `POST /api/packages/{id}/items`) pertenece a DECOR-27 y todavía no existe. DECOR-20 es solo consumidor de ese contrato, así que la interfaz se construye contra el contrato fijado y usa una implementación simulada hasta que DECOR-27 se integre.

## What Changes

- La portada añade la llamada a la acción "Crear mi paquete", que lleva a `/packages`.
- `/packages` pasa a ser "Define tu espacio": formulario con tipo de espacio (Casa, Aire libre, Salón social) y capacidad en m² positiva y finita. Conserva el aviso de sesión y el cierre de sesión de DECOR-38.
- Nueva página protegida `/packages/[packageId]` con el catálogo: tarjetas con poster, precio en COP, área y botón "Agregar", más estados de carga, vacío, error y reintento.
- Utilidades de interfaz en `src/app/(protected)/packages/_lib/`: validación del espacio, formato COP y m², lectura de errores HTTP, cliente del catálogo y puerto `PackagesClient` con dos implementaciones (HTTP y simulada).
- Variable `NEXT_PUBLIC_DECOR_PACKAGES_API` (`simulated` por defecto, `live` al integrarse DECOR-27) en `.env.example`, `Dockerfile` y `compose.yaml`.
- `vitest.setup.ts` registra la limpieza de Testing Library entre pruebas.
- `playwright.config.ts` fija `workers: 1`, porque los archivos E2E autenticados comparten una cuenta real.
- Pruebas unitarias y E2E móviles del recorrido.

## Capabilities

### New Capabilities

- `mobile-entry-catalog`: recorrido móvil inicial (portada, definición del espacio, creación del paquete y catálogo) consumiendo únicamente Route Handlers.

### Modified Capabilities

Ninguna.

## Impact

- Añade código bajo `src/app/(protected)/packages/` y `e2e/mobile-entry-catalog.spec.ts`.
- Modifica `src/app/page.tsx`, `src/app/(protected)/packages/page.tsx`, `src/app/globals.css`, `vitest.setup.ts`, `playwright.config.ts`, `.env.example`, `Dockerfile`, `compose.yaml` y `docs/DecorAR.md`.
- No crea `src/app/api/packages/*` (DECOR-27) ni modifica `GET /api/modules` (DECOR-28).
- No añade dependencias.
