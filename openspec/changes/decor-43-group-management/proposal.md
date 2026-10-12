# Proposal

## Why

DECOR-25 dejó el Composite persistido, pero la interfaz solo expone la receta fija "Zona de bienvenida" y el backend no ofrece renombrar ni eliminar grupos ("Mover, renombrar o eliminar grupos" era Non-Goal de DECOR-25). DECOR-43 pide separar la organización de zonas del configurador en un paso opcional posterior al espacio, gestionarlas por completo (crear, renombrar, eliminar sin perder contenido), elegir la zona de destino desde el catálogo y que duplicar un paquete conserve la jerarquía con mejor confirmación.

## What Changes

- Añadir `PATCH /api/packages/{packageId}/groups/{groupId}` (renombrar, 200) y `DELETE /api/packages/{packageId}/groups/{groupId}` (eliminar promoviendo el contenido al padre, 204), con sesión, propiedad, versión, `x-correlation-id` y códigos de error consistentes.
- Añadir al dominio `validarNombreGrupo`, `ModuloCompuesto.renombrar` y `PaqueteDecoracion.disolverGrupo`; los casos de uso `RenamePackageGroupUseCase` y `DeletePackageGroupUseCase`; y los métodos `renameGroup`/`deleteGroup` del puerto y del adaptador Supabase.
- Añadir la migración `20261015000000_manage_package_groups.sql`: columna `packages.structure_version`, ajuste del trigger de profundidad para permitir re-asignar el padre solo dentro de `delete_package_group`, y las RPC transaccionales `rename_package_group` y `delete_package_group`.
- Añadir la página `/packages/{id}/groups/setup` (crear, renombrar, eliminar con confirmación, continuar u omitir), a la que navega la creación del paquete en modo live, y el enlace "Administrar zonas" en el configurador.
- Añadir al catálogo el selector "Agregar en" (nivel principal o cualquier zona con su ruta) y enviar `parentGroupId` al agregar.
- Retirar `WelcomeZoneButton`; la demo de dominio `crearZonaBienvenida` se conserva.
- Duplicar: protección síncrona contra doble envío, anuncio `aria-live` y confirmación "Copia creada" en el configurador de la copia.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `decorative-composite`: los grupos pueden renombrarse y eliminarse sin perder contenido, y la interfaz los organiza en un paso opcional y como destino del catálogo.

## Impact

- Añade una migración SQL y su prueba PGlite (`manage-package-groups.test.ts`, registrada en `PGLITE_TESTS`).
- Añade y modifica código en `src/modules/packages`, `src/interfaces/packages`, `src/infrastructure/supabase`, `src/composition/server.ts` y `src/app/(protected)/packages`.
- Añade `src/app/api/packages/[packageId]/groups/[groupId]/route.ts`.
- Toca código de otros integrantes de forma acotada: `DuplicatePackageButton` (DECOR-24, Rafa) y el doble de prueba de `tests/package-catalog-api.test.ts` (DECOR-26), que implementa el puerto ampliado.
- No cambia el contrato de eventos (DECOR-29), la outbox (DECOR-32), Presupuesto (DECOR-33) ni `packages.version`: renombrar y eliminar no emiten eventos ni recalculan, y suben `packages.structure_version`.
