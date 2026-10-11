# Design

## Context

DECOR-27 dejó `PaqueteDecoracion` con una lista plana de `ModuloDecoracion` y `package_items` sin estructura. DECOR-32 es dueño de `commit_package_change`, la RPC que muta un ítem, sube la versión e inserta el evento en `private.domain_events` en una transacción. DECOR-33 calcula el presupuesto como la suma de las hojas (`calculateBudget` ya admite grupos) y relee el paquete en vez de confiar en el payload. DECOR-24 clona paquetes con `clone_package`, copiando los ítems planos.

## Goals / Non-Goals

**Goals:**

- Composite en el dominio con los nombres fijados: `ComponenteDecorativo`, `ElementoDecorativo`, `ModuloCompuesto`.
- Máximo tres niveles de grupos (grupo → subgrupo → sub-subgrupo; las hojas pueden estar en cualquiera) y ciclos rechazados, en el dominio y como defensa en base de datos.
- El Builder usa el contrato común.
- Crear un grupo con sus hojas sin persistencia parcial.
- Un usuario ajeno no crea grupos en otro paquete.
- Composite visible por API y con una acción mínima en la UI.

**Non-Goals:**

- Mover, renombrar o eliminar grupos.
- Vista completa de grupos expandibles y subtotales (DECOR-22).
- Cambiar el contrato de eventos, la outbox o Presupuesto.

## Decisions

### Tabla `package_groups` aparte y `package_items.group_id` opcional

Las hojas siguen en `package_items`; un grupo es una fila de `package_groups` con `parent_group_id`. Es un cambio aditivo: `commit_package_change`, el lector de presupuesto y las políticas RLS existentes siguen funcionando.

Alternativa descartada: convertir `package_items` en una tabla de nodos (hoja o grupo). Rompía `module_id NOT NULL`, `commit_package_change`, `clone_package`, el lector de presupuesto y las pruebas de DECOR-24/27/32/33 ya fusionadas.

### Las RPC de grupos reutilizan `commit_package_change`

`create_package_group` bloquea el paquete, comprueba dueño y versión, inserta el grupo y llama a `public.commit_package_change` por cada hoja dentro de la misma transacción; después asigna `group_id`. Si falla cualquier hoja, PostgreSQL revierte el grupo, las demás hojas y sus filas de outbox. Así la outbox sigue teniendo un único escritor (DECOR-32) y el evento sigue siendo `package.module.added` sin campos nuevos.

Alternativa descartada: añadir `p_parent_group_id` a `commit_package_change` o un campo `groupId` al payload. Ambas cambian contratos de otras tareas.

### Cambios estructurales sin hojas no emiten eventos

Un grupo vacío no inserta hojas, así que no hay evento, no cambia la versión del paquete y Presupuesto no recalcula. El total no cambia porque los grupos no tienen precio propio.

### Ciclos imposibles en base de datos

El trigger `set_package_group_depth` calcula la profundidad desde el padre (nunca desde el cliente) y rechaza cambiar `parent_group_id` o `package_id` después de insertar. Como un grupo nuevo solo puede colgar de un grupo existente y nadie puede re-asignar el padre, en la base no se puede formar un ciclo. El dominio igual los rechaza (`ModuloCompuesto.agregar`) y `reconstruirComponentes` los detecta al leer.

### Validación en el dominio antes del RPC

`loadPackageTree` reconstruye el árbol guardado como Composite y `PaqueteDecoracion.agregarComponente` valida capacidad (contando hojas dentro de grupos), existencia del grupo padre, niveles y ciclos antes de llamar a la RPC.

### `clone_package` copia los grupos

Copia los grupos ordenados por profundidad (padres primero) con ids nuevos y un mapa id viejo → id nuevo; cada ítem copiado conserva su grupo. Mantiene firma, permisos, códigos de error y que no emite eventos; añade `groupCount` a la respuesta.

### Endpoint `POST /api/packages/{packageId}/groups`

Body `{ name, parentGroupId?, children?: [{ moduleId }] }` → 201 `{ groupId, name, parentGroupId, depth, itemIds, packageVersion }`, con el envelope `{error:{code,message}}`. Plane no definía este endpoint; queda propuesto para que Jose lo confirme en la revisión.

## Risks / Trade-offs

- [Cada hoja sube la versión del paquete en 1] -> Igual que agregar hojas una a una; `packageVersion` devuelto es el final y Presupuesto aplica solo versiones mayores.
- [El lector de presupuesto de DECOR-33 sigue leyendo hojas planas] -> El total es idéntico porque los grupos no suman precio propio; no se toca código de Presupuesto.
- [Endpoint propuesto, no fijado en Plane] -> Se marca como propuesta en el PR; cambiarlo afecta solo la ruta, el cliente de UI y sus pruebas.
- [Límite de 20 hojas por petición] -> Límite defensivo del caso de uso; la demo usa dos.

## Migration Plan

Migración aditiva `20261012000000_create_package_groups.sql`. Debe aplicarse en el Supabase alojado antes de usar el modo `live`; los paquetes existentes quedan con todos sus ítems en la raíz (`group_id NULL`).
