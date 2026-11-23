# Tasks

## 1. Dominio

- [x] 1.1 Crear `src/modules/ar/domain/escena-montaje.ts` con `TransformacionItem {itemId, posicion: Posicion3D, rotacionDeg}` y `EscenaMontaje`, validando límites (x/z ∈ [-50,50], y ∈ [-1,5], rotación finita normalizada a [0,360)) y rechazando `itemId` duplicado; verificar con pruebas unitarias de dominio.

## 2. Aplicación

- [x] 2.1 Definir `src/modules/ar/application/ports/escena-repository.port.ts` (`leer(packageId)`, `guardar(command)`), con tipos de comando/resultado versionados. `expectedSceneVersion` es obligatorio en `GuardarEscenaCommand`/`GuardarEscenaDto` (no opcional): sin ella no se puede detectar un guardado concurrente, igual que `readExpectedVersion` en `package-controller.ts`.
- [x] 2.2 Implementar `ObtenerEscenaUseCase` y `GuardarEscenaUseCase` con `Result`/`DomainError`, sin tocar `PackageChangeConsumer` ni outbox; verificar con pruebas unitarias usando dobles del puerto.

## 3. Persistencia PostgreSQL

- [x] 3.1 Migración `20261018000000_create_package_scene_transforms.sql`: tablas `package_scenes` y `package_item_transforms`, índice único en `package_items(id, package_id)` si falta, `CHECK` de límites, RLS de solo lectura del propietario, revocar todo a `PUBLIC/anon/authenticated`.
- [x] 3.2 RPC `save_package_scene` (`SECURITY INVOKER`, `search_path=''`, solo `service_role`): lock `FOR UPDATE`, compara `expectedVersion`, valida pertenencia de cada `item_id`, reemplaza todas las filas, sube versión; sin tocar `packages.version`, outbox ni `budgets`. `p_expected_version` sigue siendo opcional a nivel de RPC SQL (mismo patrón que `move_package_item`); la obligatoriedad real se impone en el controlador HTTP.
- [x] 3.3 Prueba PGlite `create-package-scene-transforms.test.ts`: posiciones por unidad repetida, lectura tras guardar, aislamiento A/B, `packages.version`/`budgets` sin cambios, límites, conflicto de versión, cascada al borrar item. Añadir a `PGLITE_TESTS` en `vitest.config.ts`.

## 4. Infraestructura

- [x] 4.1 `src/modules/ar/infrastructure/supabase-escena-repository.ts`: adaptador del puerto sobre la RPC y la tabla, mapeo de errores (`scene.version_conflict`→409, `scene.item_not_found`→404, resto→`scene.persistence_error`); verificar con pruebas unitarias con cliente Supabase doble.

## 5. HTTP

- [x] 5.1 `src/interfaces/ar/scene-controller.ts`: `handleGet`/`handlePut`, validación de cuerpo (array de transforms, máx. 100, `expectedSceneVersion` **obligatorio** entero ≥ 0, UUID, números finitos), mapeo de estado HTTP; verificar con pruebas de controlador, incluidas 401 sin sesión y 400 cuando `expectedSceneVersion` está ausente o es `null`.
- [x] 5.2 `createSceneController()` en `src/composition/server.ts`.
- [x] 5.3 `src/app/api/packages/[packageId]/scene/route.ts` con `GET`/`PUT`, delegando en `checkPackageAccess` y el controlador; verificar con pruebas de Route Handler (401, 404, 409, 422, 200).

## 6. Documentación y verificación

- [x] 6.1 Actualizar `src/modules/ar/README.md` con el nuevo caso de uso y `docs/architecture.md` con un párrafo sobre `scene-transforms` siguiendo el estilo de los párrafos existentes de DECOR-44/editable-decorative-groups.
- [x] 6.2 Ejecutar `npm run lint`, `npm run typecheck` y las suites Vitest afectadas (unitarias nuevas + PGlite nueva + `scan-architecture.test.ts` + `service-role-boundary.test.ts`); registrar resultados y corregir regresiones propias. Suite completa: 1358 passed | 10 skipped, sin regresiones.
- [x] 6.3 Registrar un comentario de progreso en Plane DECOR-46 con rama, alcance implementado, resultados de verificación y pendientes (revisión de Jose, contrato para DECOR-47/48).
- [x] 6.4 Revisión posterior contra cada criterio de aceptación: corregido que `expectedSceneVersion` era opcional en el controlador (violaba "Guardar SHALL exigir la versión de escena esperada"), añadidos tests 401 explícitos y test de "paquete sin escena → 200 con lista vacía y versión 0".
