# Design

## Context

DECOR-25 persiste los grupos en `public.package_groups` (profundidad 1..3 calculada por trigger, padre inmutable, FK del padre con `ON DELETE CASCADE`, FK de `package_items.group_id` sin acción) y los crea con `create_package_group`. El presupuesto en vivo (DECOR-21) muestra "recalculando" mientras la versión del presupuesto sea menor que `packages.version`, y solo un evento de módulo produce un recálculo. El configurador (DECOR-22) lee el detalle del paquete en el servidor y vuelve a leerlo con `router.refresh()`.

## Goals / Non-Goals

**Goals:**

- Renombrar y eliminar grupos como operaciones server-side atómicas; eliminar nunca borra hojas ni subgrupos.
- Paso opcional de organización de zonas antes del catálogo (solo modo live) y regreso desde el configurador.
- Elegir la zona de destino al agregar desde el catálogo.
- Duplicar conservando la jerarquía, sin doble envío y con confirmación.

**Non-Goals:**

- Mover grupos o módulos existentes entre zonas a mano, drag and drop o borrado en cascada.
- Grupos en modo simulado.
- Cambiar el contrato de eventos, la outbox o Presupuesto.

## Decisions

### Versión estructural aparte: `packages.structure_version`

Renombrar y eliminar suben `structure_version` y no tocan `packages.version`. Si subieran `packages.version` sin emitir un evento, el presupuesto confirmado quedaría para siempre por detrás y la interfaz mostraría "recalculando" indefinidamente. La concurrencia sigue protegida: las RPC comparan `p_expected_version` con `packages.version` y bloquean la fila del paquete con `FOR UPDATE`.

Alternativa descartada: subir `packages.version` y adelantar también `budgets.package_version`. Toca la tabla de Presupuesto y deja una carrera con un recálculo en vuelo.

### Re-asignar el padre solo dentro de `delete_package_group`

El trigger de DECOR-25 sigue rechazando con `package.group_immutable` cualquier cambio de padre por UPDATE directo. `delete_package_group` activa el ajuste local de la transacción `decorar.group_reparent` (`set_config(..., true)`), mueve primero las hojas, luego el subárbol (cada descendiente sube un nivel; los hijos directos toman el padre del grupo eliminado) y borra el grupo al final. Antes de confirmar verifica que todo grupo del paquete quede exactamente un nivel bajo su padre y que ninguna hoja apunte al grupo eliminado; si no, `package.group_integrity` y rollback.

Alternativas descartadas: `ALTER TABLE ... DISABLE TRIGGER` (exige ser dueño de la tabla y no es local a la transacción) y borrar y recrear los subgrupos (cambia sus ids).

### Dominio antes de la RPC, base como defensa

Los casos de uso arman el árbol con `loadPackageTree`, validan el nombre con la misma regla de `crear` (`validarNombreGrupo`) y la existencia del grupo (`buscarGrupo` / `disolverGrupo`), y pasan la versión leída como `expectedVersion`. La RPC repite las comprobaciones.

### Contratos HTTP

`PATCH` responde 200 `{groupId, name, structureVersion}`; `DELETE` responde 204 sin cuerpo, como `DELETE /items/{itemId}`. Errores: 400 `package.invalid_body`/`package.invalid_group_name`/`package.invalid_group`, 401, 404 `package.not_found`/`package.group_not_found`, 409 `package.version_conflict`, 422 `package.group_integrity`, 500 controlado. Son una propuesta para la revisión de Jose.

### Interfaz sin árbol optimista

Las zonas se extraen del detalle del servidor con `toGroupOptions` (preorden, ruta "Sala › Mesa", nivel y conteos directos) y cada operación termina con `router.refresh()`. El navegador no valida nombre, niveles ni propiedad; solo deja de ofrecer como padre las zonas de nivel 3, que el servidor rechazaría siempre. La eliminación se confirma en un panel en la misma fila (no un `<dialog>`), que indica a dónde pasa el contenido. El catálogo usa un único selector "Agregar en"; dentro de una zona limita la cantidad a una unidad por acción porque `POST /items` rechaza lotes con `parentGroupId`.
