# Packages

- `domain`: evento (agregado técnico `package`), elementos, Composite y diagnóstico espacial.
- `application`: construcción, metadatos, plantillas y edición de zonas mediante puertos y casos de uso.
- `infrastructure`: persistencia server-side y RPC de copia.

DECOR-27 añadirá los primeros contratos funcionales. Este módulo publica eventos; nunca importa `budget`.

DECOR-44 presenta la interfaz como "eventos" y "plantillas" sin renombrar el agregado `package`, las rutas ni los contratos. Un evento se crea solo con `name`; cliente, fecha, lugar, tipo de evento, tipo de espacio y área son opcionales y editables por `PATCH /api/packages/{id}`. La capacidad dejó de ser una regla de admisión: `domain/spatial-diagnostic.ts` deriva `pending | compatible | exceeded` y el exceso nunca impide guardar. Las plantillas privadas son un snapshot normalizado (`event_templates`, `event_template_groups`, `event_template_items`) sin cliente, fecha ni lugar; se gestionan desde `src/interfaces/templates` con `checkEventTemplateAccess` y las RPC atómicas `create_event_template_from_package` y `create_package_from_event_template` (copia profunda, IDs nuevos), más `rename_event_template` y `delete_event_template`. RLS concede solo lectura al propietario; eliminar una plantilla no altera los eventos creados desde ella.

Autorización: DECOR-30 entrega `checkPackageAccess(authorizePackageAccess, packageId)` (`src/interfaces/packages/package-access.ts`, composición `createPackageAccessDependencies()`). Cada Route Handler que añada DECOR-27 deberá llamarlo antes del caso de uso y devolver su `response` si el acceso se deniega. La propiedad se compara en `application/authorize-package-access.use-case.ts` y no depende de RLS.

Las tablas `public.packages` y `public.package_items` (DECOR-32) son mínimas y DECOR-27 las amplía. Toda escritura pasa por `PackageChangeOutbox.commit` (`src/modules/events/application/outbox.ts`), que guarda el cambio y su evento en una sola transacción; no se encadenan peticiones.

Composite (DECOR-25): `domain/decorative-component.ts` define `ComponenteDecorativo`; `ElementoDecorativo` es la hoja y `ModuloCompuesto` el grupo decorativo ("Zona" en la interfaz, máximo tres niveles, sin ciclos). Los grupos se guardan en `public.package_groups`; el detalle reconstruye el árbol con `reconstruirComponentes` (`domain/package-structure.ts`).

Composite editable (extiende DECOR-25): el editor administra zonas reales en lugar de la demostración fija. Endpoints `POST /api/packages/{id}/groups` (crear zona vacía o con hojas), `PATCH|DELETE /api/packages/{id}/groups/{groupId}` (renombrar y/o mover; eliminar con `strategy: move_to_root | delete_contents`) y `PATCH /api/packages/{id}/items/{itemId}` (mover una instancia). `ModuloCompuesto.renombrar` conserva id, padre, subzonas y hojas con el mismo recorte 1..80; `PaqueteDecoracion.moverComponente` reubica un componente validando self/descendiente y tres niveles antes de escribir, y rechaza un destino inexistente. Cada mutación exige `expectedVersion` y usa una RPC atómica `SECURITY INVOKER` con `search_path = ''`: `create_package_group`, `update_package_group`, `delete_package_group` y `move_package_item`, ejecutables sólo por `service_role`.

Identidad de items y eventos: mover una instancia conserva `itemId` y `moduleId`, no toca el catálogo y emite `package.module.moved` (payload `itemId/moduleId/fromGroupId/toGroupId`, `null` = raíz). `move_to_root` emite un `moved` por hoja directa y sube sus subzonas a la raíz; `delete_contents` emite un `removed` por hoja del subárbol. Renombrar o reparentar no producen eventos de módulo: sólo suben una vez la versión del evento. El exceso de área nunca bloquea; el diagnóstico espacial sólo lo informa.

Las plantillas privadas de DECOR-44 no cambian: `create_event_template_from_package` y `create_package_from_event_template` siguen copiando `package_groups`/`package_items` por profundidad con IDs nuevos, de modo que el snapshot conserva la jerarquía editada y queda independiente del origen.
