# Tasks

## 1. Esquema de datos y persistencia

- [x] 1.1 Crear migración SQL para la tabla `catalog_modules` con checks de validación, unicidad y política RLS para activos
- [x] 1.2 Crear seed SQL inicial con `mesa`, `arco` y `pista` en estado `draft`
- [x] 1.3 Crear fixture JSON mock para Mei en `public/fixtures/catalog-modules.json`

## 2. Dominio y aplicación de catálogo

- [x] 2.1 Implementar la entidad `CatalogModule` y sus pruebas unitarias en `src/modules/catalog/domain/`
- [x] 2.2 Implementar el puerto `CatalogRepository`, el DTO de salida y el caso de uso `GetActiveCatalogModulesUseCase` con pruebas unitarias en `src/modules/catalog/application/`

## 3. Infraestructura y composición

- [x] 3.1 Implementar el adaptador `SupabaseCatalogRepository` y pruebas en `src/modules/catalog/infrastructure/`
- [x] 3.2 Implementar el controlador `CatalogController` y pruebas en `src/interfaces/catalog/`
- [x] 3.3 Conectar dependencias en `src/composition/server.ts` exponiendo `createCatalogController`

## 4. Entrada HTTP y verificación integral

- [x] 4.1 Implementar el Route Handler `GET /api/modules` en `src/app/api/modules/route.ts` con pruebas de integración
- [x] 4.2 Ejecutar escáner de arquitectura `scripts/scan-architecture.test.ts` asegurando cero violaciones
- [x] 4.3 Ejecutar gates de calidad: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`
