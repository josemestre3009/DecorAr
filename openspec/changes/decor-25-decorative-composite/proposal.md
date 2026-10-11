# Proposal

## Why

`docs/DecorAR.md` §1.4 y §4.3 exigen el patrón Composite: un paquete contiene elementos simples y grupos (p. ej. "Zona de bienvenida" = arco floral + mesa redonda) que se tratan igual al calcular precio y área, con un máximo de tres niveles de grupos y sin ciclos. Hoy `PaqueteDecoracion` guarda una lista plana, `package_items` no tiene grupos y `POST /api/packages/{id}/items` rechaza `parentGroupId` con `package.grouping_not_supported` (DECOR-27 lo dejó así porque los grupos pertenecen a esta tarea).

## What Changes

- Añadir al dominio de `packages` el contrato `ComponenteDecorativo`, la hoja `ElementoDecorativo` y el compuesto `ModuloCompuesto`, que suma precio y área recursivamente y rechaza ciclos y un cuarto nivel. Añadir la demo `crearZonaBienvenida`.
- Hacer que `PaqueteDecoracion` y el Builder (`PaqueteDecoracionBuilderImpl`) usen el contrato común; `agregarZonaBienvenida()` y `agregarComponente()` se suman a los métodos canónicos existentes, que no cambian.
- Añadir la migración `public.package_groups` y `package_items.group_id`, con defensa en base de datos (profundidad calculada por trigger y limitada a 1..3, posición inmutable, FKs compuestas del mismo paquete, RLS de solo lectura para el dueño).
- Añadir las RPC atómicas `create_package_group` y `add_package_item_to_group` (SECURITY INVOKER, `search_path=''`, solo `service_role`), que reutilizan `commit_package_change` de DECOR-32 por cada hoja.
- Redefinir `clone_package` (DECOR-24) para que copie también los grupos con ids nuevos y conserve la estructura.
- Añadir los casos de uso `CreatePackageGroupUseCase` y `AddModuleToGroupUseCase`, el adaptador `SupabasePackageGroupRepository`, `POST /api/packages/{packageId}/groups` y habilitar `parentGroupId` en `POST /items`.
- Añadir en `/packages/[packageId]` un botón mínimo "Agregar Zona de bienvenida" que hace visible el Composite; la vista completa queda para DECOR-22.

## Capabilities

### New Capabilities

- `decorative-composite`: grupos decorativos anidados (máximo tres niveles, sin ciclos) creados de forma atómica, con un `package.module.added` por hoja y sin eventos para cambios solo estructurales.

### Modified Capabilities

Ninguna capability de OpenSpec. `clone_package` (DECOR-24) amplía su copia profunda a los grupos sin cambiar su firma, permisos ni códigos de error.

## Impact

- Añade una migración SQL y su prueba ejecutable con PGlite.
- Añade y modifica código en `src/modules/packages`, `src/interfaces/packages`, `src/infrastructure/supabase` y `src/composition/server.ts`.
- Añade `src/app/api/packages/[packageId]/groups/route.ts` y un componente de UI.
- No cambia el contrato de eventos (DECOR-29), la outbox (DECOR-32) ni Presupuesto (DECOR-33): los grupos no tienen precio propio y el total sigue siendo la suma de las hojas.
