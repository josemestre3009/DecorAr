# Catalog

- `domain`: entidad `CatalogModule` y reglas invariantes del catálogo (validación de activos completos y positivos), sin frameworks.
- `application`: puerto `CatalogRepository`, DTO `CatalogModuleDto` y caso de uso `GetActiveCatalogModulesUseCase`.
- `infrastructure`: adaptador server-side `SupabaseCatalogRepository` que consulta la tabla `catalog_modules` en PostgreSQL/PostgREST.

Implementado bajo DECOR-28. Este módulo no depende de `packages` ni `budget`.
