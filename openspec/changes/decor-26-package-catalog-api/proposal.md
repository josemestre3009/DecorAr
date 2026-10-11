# Proposal

## Why

DECOR-26 exige evidencia reproducible y cobertura de integración de Catálogo, Builder, Prototype y Composite a través de la API y persistencia, garantizando las secciones 8.17 (API o interacción funcional) y 8.18 (Manejo de errores) de `docs/Actividad.md`:
- Pruebas de integración de todos los endpoints de paquetes, catálogo y patrones.
- Reseteo determinista y repetible de la base de datos alojada de Supabase mediante un script SQL server-side versionado, sin requerir el CLI local.
- Cobertura de códigos de estado HTTP `200/201`, `204`, `400`, `401`, `404`, `422` y `500` controlado con trazabilidad de `correlationId`.
- Demostración de atomicidad transaccional (un fallo no deja estados parciales) y de aislamiento de eventos (un rechazo del Builder no publica en outbox).
- Demostración de los 3 fixtures del Builder, copia profunda en Prototype y grupos/niveles/ciclos en Composite.
- Colección reproducible de peticiones HTTP en un archivo `.http`.

## What Changes

- Añadir el script de reseteo server-side `supabase/reset-test-database.sql`.
- Añadir la suite automatizada de integración `tests/package-catalog-api.test.ts`.
- Añadir la colección de peticiones HTTP `tests/package-catalog-api.http`.
- Añadir el runner de integración ejecutable para Supabase alojado `scripts/run-package-api-integration.ts`.
- Actualizar la documentación de arquitectura en `docs/DecorAR.md` con la trazabilidad y diagrama de patrones integrados.

## Capabilities

### New Capabilities

- `package-catalog-api-integration`: suite de integración reproducible para catálogo, paquetes, patrones GoF (Builder, Prototype, Composite), control de errores, observabilidad y reseteo server-side.

### Modified Capabilities

- Ninguna. No se alteran contratos existentes de backend ni migraciones de producción; se dota al repositorio de la suite de validación y evidencia completa.

## Impact

- Nuevos archivos de pruebas, scripts de soporte y documentación.
- Verificación garantizada tanto en PostgreSQL embebido (PGlite) como en Supabase alojado.
