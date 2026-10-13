# Design

## Context

El Composite existente modela hojas y grupos anidados hasta tres niveles. `POST /api/packages/{packageId}/groups` crea grupos y hojas mediante `create_package_group`; `POST /items` agrega raíz o grupo; `DELETE /items/{itemId}` elimina una hoja. `package_groups` impide cambiar padre, no existen renombrado, borrado o movimiento, y el botón actual crea una demostración fija con arco y mesa.

DECOR-44 está sin commit en la rama actual y añade eventos, diagnóstico espacial y snapshots privados que copian `package_groups`/`package_items` por profundidad con IDs nuevos. La implementación deberá incorporarse sobre ese estado sin revertirlo. Véase `proposal.md` para motivación y `specs/editable-decorative-groups/spec.md` para comportamiento.

## Goals / Non-Goals

**Goals:**

- Extender el Composite y sus puertos existentes; no crear otra implementación de zonas.
- Hacer atómicas las mutaciones que cambian varias filas, versión u outbox.
- Mantener un único agregado técnico `packages` y contratos visibles orientados a eventos y zonas.
- Conservar el snapshot de plantillas de DECOR-44 sin compartir IDs ni referencias mutables.
- Reusar patrones actuales de autorización, correlación, presupuesto, refresh y accesibilidad.

**Non-Goals:**

- Drag-and-drop, orden manual o persistencia de orden.
- Renombrar tablas, DTO técnicos, `groupId`, `package_groups` o rutas `/packages`.
- Añadir endpoints distintos de los cuatro contratos acordados.
- Cambiar el catálogo o acoplar el módulo packages con budget.
- Introducir dependencias o un segundo árbol de zonas.

## Decisions

### 1. Un solo editor sobre el detalle existente

`PackageContents` seguirá siendo la representación canónica del árbol. La demostración `WelcomeZoneButton` se reemplazará por un formulario inline de "Nueva zona" conectado al mismo cliente de grupos. El detalle server-side seguirá entregando nodos; `router.refresh()` reconciliará contenido, diagnóstico y versión después de cada éxito.

El catálogo recibirá las zonas planas derivadas del mismo detalle y ofrecerá un selector `Sin zona | zonas válidas`, manteniendo la acción rápida actual a raíz. No se añadirá un store global ni una segunda consulta de grupos.

Alternativa descartada: editor separado con estado local optimista. Duplicaría el árbol, complicaría conflictos y podría divergir del diagnóstico server-side.

### 2. `PATCH /groups/{groupId}` combina nombre y padre

El cuerpo admitirá al menos uno de `name` o `parentGroupId`; `null` representa raíz. Un único caso de uso de actualización carga el árbol, aplica `renombrar` y/o `mover`, valida el resultado antes de persistir y envía la versión observada a la RPC.

Alternativa descartada: endpoint `/move`. Los contratos esperados ya cubren ambas mutaciones y separar rutas no aporta aislamiento transaccional.

### 3. El Composite gana operaciones, no otro modelo

`ModuloCompuesto` hará mutable el nombre mediante una operación validada y expondrá movimiento seguro usando remover/agregar con rollback en memoria si el destino falla. La validación comprobará identidad, descendientes y profundidad total del subárbol. Los casos de uso cargarán siempre el árbol completo para decidir antes de escribir.

Alternativa descartada: validar ciclos únicamente en SQL. Rompería la regla actual de validar primero en dominio y ofrecería errores más tardíos.

### 4. RPC transaccionales serializadas por versión

Una migración aditiva reemplazará la inmutabilidad de `parent_group_id` por validación de reparentado. Las RPC bloquearán el evento propietario `FOR UPDATE`, compararán `expectedVersion`, validarán que todos los IDs pertenezcan al mismo evento y confirmarán todos los cambios o ninguno.

- `create_package_group` se ajustará para que incluso una zona vacía incremente una vez la versión.
- `update_package_group` actualizará nombre y/o padre, recalculará profundidades del subárbol y subirá una vez la versión.
- `delete_package_group` aplicará `move_to_root` o `delete_contents` dentro de una transacción.
- `move_package_item` cambiará `group_id`, preservará el item y subirá una vez la versión.

Todas usarán `SECURITY INVOKER`, `SET search_path = ''`, nombres totalmente calificados, `REVOKE` para `PUBLIC/anon/authenticated` y `GRANT EXECUTE` solo a `service_role`. Las tablas conservarán lectura RLS del propietario y ninguna escritura directa para clientes.

Alternativa descartada: secuencias de `update/delete` desde TypeScript. Permitirían estados parciales y ampliarían carreras.

### 5. Semántica precisa de eliminación

`move_to_root` mueve a raíz los módulos asignados directamente a la zona y sus subzonas directas; los subárboles de esas subzonas permanecen intactos. Después elimina solo la zona seleccionada.

`delete_contents` obtiene el subárbol con CTE recursiva, elimina todos sus módulos mediante la misma semántica de eventos de remoción y elimina las zonas de hojas a raíz. La FK de ítems seguirá impidiendo huérfanos; no se confiará en una cascada silenciosa porque cada módulo eliminado necesita outbox.

Alternativa descartada: mover contenido al padre. El contrato visible exige explícitamente raíz y debe comportarse igual para zona raíz o subzona.

### 6. Eventos, versión y presupuesto

Las mutaciones estructurales sin cambio de módulos incrementarán versión, pero no crearán eventos de presupuesto. Agregar mantiene `package.module.added`; eliminación destructiva mantiene un `package.module.removed` por módulo. Mover una instancia emitirá `package.module.moved` con identidad y origen/destino, sin borrar ni recrear el item.

El contrato de eventos, parser, publicador y consumidor de presupuesto se ampliarán con `package.module.moved`. El consumidor seguirá dependiendo solo del puerto de lectura del evento y reconciliará contra la versión final; el caso de uso packages no importará budget. `move_to_root` emitirá moved por cada módulo directo trasladado. Reparentar una zona no emitirá eventos por cada descendiente porque los items conservan `group_id`; la versión invalida vistas del agregado.

Alternativa descartada: representar movimiento como remove+add. Distorsionaría identidad, duplicaría versiones y podría producir presupuesto intermedio incorrecto.

### 7. Errores HTTP y propiedad indistinguible

Los Route Handlers reutilizarán `checkPackageAccess` antes de casos de uso. Las RPC repetirán propiedad en el lock del evento. Zona, item o destino que no pertenezca al evento se mapeará a 404; forma JSON/UUID inválida a 400; versión a 409; nombre, ciclo y profundidad a 422. Los responses conservarán `correlationId` y envelopes actuales.

Alternativa descartada: distinguir recurso ajeno de inexistente. Revelaría existencia y contradice la autorización actual.

### 8. Interacciones inline y foco

Cada fila de zona tendrá acciones textuales para renombrar, crear subzona, mover y eliminar. Renombrar, seleccionar padre y confirmar borrado reemplazarán controles dentro de la fila, sin modal. Los botones usarán guardas de ejecución y `aria-disabled` cuando deba conservarse el foco. Errores tendrán IDs estables, `aria-invalid`/`aria-describedby`; una región viva única del contenido anunciará resultados.

Al desaparecer una fila, el foco volverá primero a la siguiente acción lógica disponible; si no existe, al encabezado de contenido. Los toggles conservarán `aria-expanded` y `aria-controls`. La jerarquía usará las filas existentes, sangría y divisores en vez de una cuadrícula de tarjetas.

Alternativa descartada: modal universal. Añade gestión de foco y contexto innecesaria para formularios breves.

### 9. Compatibilidad con DECOR-44

Las RPC de evento→plantilla y plantilla→evento ya copian grupos ordenados por profundidad y mapean `group_id`. No se duplicará esa lógica. Las pruebas se ampliarán para crear la estructura mediante el editor final antes del snapshot y comprobar nombres, padres, ubicación, IDs nuevos e independencia.

La implementación editará los archivos DECOR-44 existentes solo donde sea necesario para integración; no reemplazará sus cambios ni creará migraciones que dependan de IDs generados por otra migración.

## Risks / Trade-offs

- [El nuevo evento `package.module.moved` amplía consumidores] → actualizar parser, ejemplos, publicador, presupuesto y pruebas de compatibilidad en un corte único.
- [Reparentar exige recalcular descendientes] → CTE recursiva bajo lock, validación previa de profundidad máxima y rollback PGlite.
- [Borrado destructivo puede generar muchos eventos] → límite natural del agregado, inserción en lote dentro de una RPC y una sola reconciliación final.
- [Múltiples formularios inline pueden competir] → permitir una sola acción activa por fila/editor y bloquear mutaciones globales durante refresh.
- [DECOR-44 permanece sin commit] → basar diffs en el worktree actual, tocar mínimamente y ejecutar sus pruebas de plantilla además de las nuevas.
- [La versión de grupos vacíos cambia respecto al comportamiento histórico] → migración y pruebas actualizan explícitamente el contrato; clientes siempre consumen la versión devuelta/refrescada.

## Migration Plan

1. Integrar primero sobre el estado final de DECOR-44; conservar su migración y añadir una migración posterior para edición de zonas.
2. Añadir contrato de evento moved, dominio, puertos, casos de uso y adaptadores con pruebas unitarias.
3. Aplicar trigger/RPC/permisos aditivos; verificar PGlite, rollback, huérfanos, RLS y versiones.
4. Añadir Route Handlers y clientes; verificar matriz 400/401/404/409/422.
5. Sustituir la demostración por editor inline y selectores de catálogo/contenido; verificar teclado, foco y responsive.
6. Ampliar snapshot de plantilla, E2E live, documentación y validaciones completas.

Rollback de aplicación: desplegar una versión que no exponga acciones nuevas antes de revertir RPC. No revertir columnas ni borrar datos; la migración mantiene el esquema legible por clientes anteriores. Si `package.module.moved` ya existe en outbox, el consumidor desplegado durante rollback debe seguir tolerándolo hasta drenar eventos pendientes.
