# Tasks

## 1. Dominio

- [x] 1.1 Añadir `ComponenteDecorativo`, `ElementoDecorativo` y `ModuloCompuesto` con suma recursiva, máximo tres niveles y rechazo de ciclos; verificar con `composite-module.test.ts`.
- [x] 1.2 Añadir `crearZonaBienvenida` (arco floral + mesa redonda).
- [x] 1.3 `PaqueteDecoracion` y `PaqueteDecoracionBuilderImpl` usan el contrato común (`agregarComponente`, `agregarZonaBienvenida`); las pruebas del Builder existentes siguen pasando.
- [x] 1.4 Añadir `reconstruirComponentes` para armar el árbol guardado; verificar con `package-structure.test.ts`.

## 2. Persistencia

- [x] 2.1 Migración `package_groups`, `package_items.group_id`, trigger de profundidad e inmutabilidad, RLS de lectura para el dueño.
- [x] 2.2 RPC `create_package_group` y `add_package_item_to_group` reutilizando `commit_package_change`.
- [x] 2.3 `clone_package` copia los grupos conservando la estructura.
- [x] 2.4 Prueba PGlite `create-package-groups.test.ts`: atomicidad, niveles, ciclos, propiedad, RLS, clonación y cascada.

## 3. Aplicación e infraestructura

- [x] 3.1 Puertos `PackageGroupReader`/`PackageGroupRepository` y DTOs.
- [x] 3.2 Casos de uso `CreatePackageGroupUseCase` y `AddModuleToGroupUseCase` con validación de dominio antes del RPC.
- [x] 3.3 Adaptador server-only `SupabasePackageGroupRepository` y cableado en `createPackageController`.

## 4. HTTP y UI

- [x] 4.1 `POST /api/packages/{packageId}/groups` y `parentGroupId` habilitado en `POST /items`, con `checkPackageAccess`.
- [x] 4.2 Botón "Agregar Zona de bienvenida" en `/packages/[packageId]` con su cliente.

## 5. Integración

- [x] 5.1 Prueba de aceptación `decor-25-acceptance.test.ts`.
- [x] 5.2 Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- [x] 5.3 Ejecutar `openspec validate decor-25-decorative-composite --type change --strict`: válido (`npx -y @fission-ai/openspec@1.14.1`, sin instalar el CLI).
- [ ] 5.4 Aplicar la migración en el Supabase alojado (requiere acceso de Jose/Luis).

## 6. Revisión del PR #18

- [x] 6.1 F2: una sola notificación a Presupuesto por grupo creado (último evento).
- [x] 6.2 F3: `parentGroupId` vacío o en blanco responde 400 `package.invalid_group` en `POST /items` y `POST /groups`.
- [x] 6.3 F4: timeouts largos solo para las suites PGlite (proyecto `pglite` en `vitest.config.ts`, en serie).
- [x] 6.4 Smoke test opt-in `e2e/package-groups-live.spec.ts` (`DECOR_LIVE_SMOKE=1`) contra la API real.
- [ ] 6.5 Ejecutar el smoke test cuando la migración esté aplicada (5.4).
