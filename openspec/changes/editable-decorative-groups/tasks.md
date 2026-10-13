# Tasks

## 1. Dominio Composite y contratos de eventos

- [x] 1.1 Extender `ModuloCompuesto`/`PaqueteDecoracion` con renombrado y movimiento transaccional en memoria, conservando IDs y validando trim 1..80, ciclos y profundidad total; verificar con pruebas de dominio para nombres, tres niveles, movimiento válido, self/descendant y rollback del árbol.
- [x] 1.2 Añadir DTO, comandos y puertos mínimos para crear vacío, actualizar, eliminar zonas y mover módulos con `expectedVersion`; verificar que las pruebas de tipos y dobles existentes compilen sin una implementación paralela.
- [x] 1.3 Incorporar `package.module.moved` al contrato compartido, parser, ejemplos y publicador, preservando added/removed; verificar pruebas unitarias de serialización, rechazo de payload inválido y compatibilidad de versiones.
- [x] 1.4 Actualizar documentación del módulo packages con reglas del Composite editable, identidad de items y semántica de eventos; verificar que no documente capacidad como bloqueo ni use "paquete" como concepto visible.

## 2. Casos de uso y concurrencia

- [x] 2.1 Ajustar creación de grupo para zonas vacías versionadas y añadir casos de uso de actualización, eliminación y movimiento de item sobre `loadPackageTree`; verificar unitariamente éxito, validación, recurso ajeno/inexistente y propagación de versión/correlación.
- [x] 2.2 Implementar ambas estrategias de eliminación en aplicación, generando removals para `delete_contents` y moves para módulos directos en `move_to_root`; verificar árboles con subzonas, ausencia de huérfanos lógicos y una sola notificación final a consumidores.
- [x] 2.3 Implementar movimiento de módulo sin recrear la instancia ni tocar catálogo; verificar raíz→zona, zona→zona, zona→raíz, destino inválido y conflicto de versión.
- [x] 2.4 Ampliar el consumidor de presupuesto para aceptar `package.module.moved` mediante el puerto actual y reconciliar la versión final sin importar budget desde packages; verificar added/removed/moved e idempotencia en pruebas de aplicación.

## 3. Persistencia PostgreSQL segura

- [x] 3.1 Añadir una migración posterior a DECOR-44 que permita reparentar con defensa SQL de ciclos/profundidad y defina RPC de crear, actualizar, eliminar y mover item; verificar `SECURITY INVOKER`, `search_path = ''`, nombres calificados y firmas únicas mediante prueba PGlite.
- [x] 3.2 Implementar locks de agregado, `expectedVersion`, incremento único por operación, outbox en lote y correlación en las RPC; verificar versiones y eventos exactos para create/rename/reparent/move/move_to_root/delete_contents.
- [x] 3.3 Garantizar atomicidad de cada estrategia y movimiento con fallos inducidos; verificar rollback de grupos, items, profundidad, versión y outbox, además de cero referencias huérfanas.
- [x] 3.4 Mantener RLS de lectura por dueño y revocar escritura/ejecución a `PUBLIC`, `anon` y `authenticated`, concediendo RPC solo a `service_role`; verificar permisos y aislamiento A/B en PGlite/integración alojada.
- [x] 3.5 Extender `SupabasePackageGroupRepository` y adaptadores relacionados con las RPC y códigos de error precisos; verificar mappings 404/409/422, UUID inválido y errores de persistencia con pruebas de infraestructura.
- [x] 3.6 Probar que las RPC DECOR-44 siguen copiando la jerarquía editada y ubicaciones con IDs nuevos, rollback e independencia; verificar evento→plantilla→evento sin modificar migraciones existentes de DECOR-44.

## 4. HTTP y composición

- [x] 4.1 Cablear los nuevos casos de uso en composición y ampliar `PackageController` para PATCH/DELETE de grupo y PATCH de item, reutilizando `checkPackageAccess` y correlation IDs; verificar 400, 401, 404 indistinguible, 409 y 422 en pruebas de controlador.
- [x] 4.2 Crear `groups/[groupId]/route.ts` con PATCH/DELETE y ampliar `items/[itemId]/route.ts` con PATCH, sin endpoints adicionales; verificar métodos, params asíncronos, envelopes y errores no capturados en pruebas de Route Handler.
- [x] 4.3 Validar estrictamente cuerpos `{name?, parentGroupId?}`, `{strategy}` y `{groupId}`, exigiendo al menos un cambio y versión esperada según el contrato cliente; verificar JSON roto, campos ausentes, tipos erróneos y UUID mal formado antes de persistencia.
- [x] 4.4 Ejecutar pruebas HTTP/integración con sesión anónima, propietario y segundo usuario; verificar que evento, zona, item o destino ajeno/inexistente siempre produzcan 404 sin escritura ni filtración.

## 5. Clientes y editor inline

- [x] 5.1 Ampliar `package-groups-client.ts` y `packages-client.ts` con contratos tipados de crear, renombrar/mover zona, eliminar y mover item; verificar URLs, cuerpos, respuestas, fallos de red y modo simulado sin dependencias nuevas.
- [x] 5.2 Reemplazar `WelcomeZoneButton` por el formulario inline "Nueva zona" con nombre obligatorio y selección opcional de padre, guardas anti doble envío y errores accesibles; verificar trim, 1..80, pending, 401, éxito, error y foco en pruebas de componente.
- [x] 5.3 Extender `PackageContents` con acciones inline de renombrar, crear subzona, mover y eliminar, conservando toggle `aria-expanded`, métricas y jerarquía; verificar operaciones, ciclos/profundidad visibles, estados pendientes y responsive.
- [x] 5.4 Implementar confirmación inline de eliminación con las dos estrategias y cancelar; verificar textos exactos, teclado completo, `aria-describedby`, anuncios y retorno de foco tras desaparecer una fila.
- [x] 5.5 Añadir movimiento de cada instancia de módulo desde contenido entre `Sin zona` y zonas válidas, sin colapsar cantidades de forma que se pierda `itemId`; verificar raíz↔zona, zona↔zona, conflicto y refresco de contenido/diagnóstico.
- [x] 5.6 Añadir selector de destino por módulo en catálogo manteniendo la acción rápida a raíz; verificar agregado a raíz/zona, exceso de área no bloqueante, conteos reconciliados y `router.refresh()`.
- [x] 5.7 Ajustar estilos existentes de papel cálido/cobre/tinta para formularios y filas operativas, incluidos hover, foco, loading, error, vacío y éxito; verificar manualmente desktop/móvil sin cuadrícula genérica nueva.

## 6. Plantillas, E2E y documentación

- [x] 6.1 Ampliar pruebas frontend integradas para crear, renombrar, mover y eliminar zonas/módulos, cubriendo errores inline, doble envío, `aria-live`, retorno de foco y viewport desktop/móvil.
- [x] 6.2 Implementar E2E live: crear evento, dos zonas y subzona, agregar raíz/zonas, mover módulo, renombrar, borrar con ambas estrategias, guardar plantilla e instanciar otro evento; verificar jerarquía, IDs independientes y ausencia de cambios cruzados.
- [x] 6.3 Actualizar `docs/DecorAR.md`, `docs/architecture.md`, `docs/Actividad.md` y README del módulo con API, RPC, autorización, outbox, presupuesto, Composite editable y copia DECOR-44; verificar nombres/rutas contra implementación real.
- [x] 6.4 Ejecutar revisión visual desktop/móvil y detector Impeccable sobre el editor; corregir hallazgos materiales y registrar una confirmación posterior limpia.

## 7. Verificación de entrega

- [x] 7.1 Ejecutar suites focalizadas de dominio, aplicación, repositorios, PGlite, HTTP y frontend; verificar que todas aprueben y que las pruebas DECOR-44 permanezcan verdes.
- [x] 7.2 Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`; registrar resultados exactos y corregir cualquier regresión propia.
- [x] 7.3 Ejecutar E2E live aplicable y autorización/RLS alojada cuando existan credenciales; registrar casos aprobados o el bloqueo verificable.
- [x] 7.4 Ejecutar `openspec validate editable-decorative-groups --strict` y comprobar que tareas, specs, diseño e implementación permanezcan coherentes.
- [x] 7.5 Consultar Plane por un work item asociado, sincronizar estado/comentarios/enlaces si existe y dejar constancia si no existe.
