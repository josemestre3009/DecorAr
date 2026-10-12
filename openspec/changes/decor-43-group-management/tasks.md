# Tasks

## 1. Dominio

- [x] 1.1 Extraer `validarNombreGrupo` y añadir `ModuloCompuesto.renombrar` y `soltarHijos`.
- [x] 1.2 Añadir `PaqueteDecoracion.disolverGrupo` (promueve hojas y subgrupos al padre); verificar con `composite-module.test.ts`.

## 2. Persistencia

- [x] 2.1 Migración `20261015000000_manage_package_groups.sql`: `packages.structure_version`, trigger con el ajuste local `decorar.group_reparent`, RPC `rename_package_group` y `delete_package_group` (SECURITY INVOKER, `search_path=''`, solo `service_role`).
- [x] 2.2 Prueba PGlite `manage-package-groups.test.ts`: renombrar, promoción raíz y anidada, atomicidad forzada, propiedad, versión, grupo inexistente o ajeno, inmutabilidad fuera de la RPC, clonación posterior y permisos.

## 3. Aplicación e infraestructura

- [x] 3.1 Ampliar `PackageGroupRepository` con `renameGroup` y `deleteGroup`; implementarlos en `SupabasePackageGroupRepository` (incluido `package.group_integrity`).
- [x] 3.2 Casos de uso `RenamePackageGroupUseCase` y `DeletePackageGroupUseCase` con sus pruebas.

## 4. HTTP y UI

- [x] 4.1 `handleRenameGroup` y `handleDeleteGroup` en `PackageController`; ruta `groups/[groupId]` (PATCH, DELETE) y composición.
- [x] 4.2 Clientes: `renameGroup`/`deleteGroup` y `addItem` con `parentGroupId`; la simulación no finge zonas.
- [x] 4.3 Página `groups/setup` con `GroupManager`; `space-form` navega a ella en modo live.
- [x] 4.4 Configurador: "Administrar zonas", selector "Agregar en", aviso "Copia creada"; retirar `WelcomeZoneButton`.
- [x] 4.5 `DuplicatePackageButton`: guarda contra doble envío y anuncio `aria-live`.

## 5. Integración

- [x] 5.1 Aceptación sobre PGlite con los casos de uso reales (sección 6 de `decor-25-acceptance.test.ts`).
- [x] 5.2 E2E opt-in `e2e/package-group-management-live.spec.ts` y ajuste de `e2e/package-configurator-live.spec.ts`.
- [x] 5.3 Documentar en `docs/DecorAR.md` y `tests/package-catalog-api.http`.
- [x] 5.4 Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- [ ] 5.5 Aplicar la migración en el Supabase alojado (requiere acceso de Jose/Luis) y ejecutar las E2E live.
