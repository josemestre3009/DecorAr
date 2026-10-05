# Design

## Context

DECOR-17 estableció los límites de Clean Architecture para el monolito modular de DecorAR y `scripts/scan-architecture.ts` verifica las dependencias entre capas. DECOR-28 implementa el primer contrato funcional del catálogo, aislando la persistencia en PostgreSQL tras adaptadores de infraestructura y exponiendo la consulta pública mediante un Route Handler Next.js sin permitir llamadas directas a Supabase desde el navegador.

## Goals / Non-Goals

**Goals:**

- Persistir `catalog_modules` en PostgreSQL garantizando en la base de datos que ningún módulo incompleto pueda marcarse como `active`.
- Proveer seed inicial reproducible con `mesa`, `arco` y `pista` en estado `draft`.
- Aislar el dominio del catálogo de librerías externas o frameworks.
- Orquestar la obtención de módulos activos mediante un caso de uso de aplicación y un adaptador de infraestructura server-side.
- Manejar peticiones HTTP mediante `CatalogController` en `src/interfaces` e inyectar dependencias desde `src/composition/server.ts`.
- Mapear nombres de base de datos (`snake_case`) al contrato acordado en `camelCase` (`id`, `name`, `priceCop`, `areaM2`, `widthM`, `heightM`, `depthM`, `glbUrl`, `usdzUrl`, `posterUrl`, `assetId`, `version`).
- Garantizar que errores 500 no expongan stack traces, SQL o secretos.
- Entregar fixture JSON idéntico a la respuesta en `public/fixtures/catalog-modules.json`.

**Non-Goals:**

- Subir archivos o integrar SDK de Cloudinary (corresponde a DECOR-36).
- Activar módulos definitivos en producción (corresponde a DECOR-36).
- Implementar la interfaz visual o vista del catálogo (corresponde a DECOR-20).
- Crear endpoints de mutación, creación o edición de catálogo (el MVP de catálogo es de consulta de lectura).

## Decisions

### Validación en base de datos mediante CHECK constraints
La integridad del catálogo se defiende en PostgreSQL:
- Precios y área mayores a cero.
- Dimensiones estrictamente positivas si están definidas.
- Si `status = 'active'`, `glb_url`, `usdz_url`, `width_m`, `height_m` y `depth_m` no pueden ser nulos.
- Unicidad en `(asset_id, version)`.

*Alternativa descartada:* Validar únicamente a nivel de aplicación. Dejaría la base de datos vulnerable a inserciones o actualizaciones incompletas desde scripts o migraciones manuales.

### RLS con política de lectura pública para módulos activos
Se habilita Row Level Security en `catalog_modules` y se otorga política `SELECT` para `status = 'active'`.

*Alternativa descartada:* Dejar la tabla abierta sin RLS o requerir service_role para lecturas ordinarias. Una política RLS pública para activos aplica el principio de defensa en profundidad.

### Limpieza de responsabilidades con Controller en `src/interfaces`
El Route Handler `src/app/api/modules/route.ts` solo recibe la petición y delega a `CatalogController.handleGetModules()`. El controlador transforma el resultado a `Response.json(...)` o a un error 500 controlado con `correlationId`.

*Alternativa descartada:* Poner la lógica HTTP y el try/catch directamente en el Route Handler. Aunque funciona, `src/interfaces` fue creado explícitamente en DECOR-17 para albergar adaptadores de entrada y desacoplar App Router del caso de uso.

## Risks / Trade-offs

- [Desfase entre nombres de campos en frontend y backend] -> Pruebas unitarias que validan la transformación de `snake_case` a `camelCase` comparando con el fixture de Mei.
- [Exposición de credenciales en respuestas 500] -> El controlador captura cualquier excepción y devuelve únicamente `{ error: "Internal Server Error", correlationId }`.
- [Módulos en draft apareciendo en la API] -> Filtro a nivel de base de datos (`eq('status', 'active')`), verificado con tests que confirman respuesta vacía para borradores.

## Migration Plan

1. Crear migración y seed en `supabase/`.
2. Crear fixture JSON para Mei en `public/fixtures/catalog-modules.json`.
3. Implementar capas de Clean Architecture: `domain`, `application`, `infrastructure`, `interfaces`, `composition` y `app/api`.
4. Ejecutar pruebas unitarias de todas las capas y de integración de la ruta.
5. Ejecutar escáner de arquitectura, lint, typecheck y build.

La reversión consiste en revertir el commit o rama; la migración puede eliminarse con `DROP TABLE catalog_modules CASCADE;`.
