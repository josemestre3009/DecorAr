# Design

## Context

`public.packages` ya es el agregado persistido y las rutas `/packages/{id}` están enlazadas desde catálogo, AR, presupuesto, outbox y Realtime. Actualmente exige `space_type` y `capacity_m2`, carece de nombre y datos del cliente, y bloquea módulos que exceden capacidad. `clone_package` ya copia atómicamente preferencias, grupos jerárquicos e ítems con IDs nuevos. `ConfiguracionEvento` demuestra Prototype en dominio, pero no está conectado a persistencia. Véase `proposal.md` para la motivación y los specs para el contrato observable.

La arquitectura exige navegador sin CRUD directo sobre tablas de negocio, Route Handlers autenticados, autorización explícita, RLS, RPC `SECURITY INVOKER` con `search_path` vacío y separación Clean Architecture. Los contratos y canales existentes usan `packageId`; deben permanecer compatibles.

## Goals / Non-Goals

**Goals:**

- Evolucionar el agregado existente con migración aditiva y sin romper IDs, URLs, presupuesto, outbox o Realtime.
- Hacer que la compatibilidad espacial sea un valor derivado, no una regla de admisión.
- Reutilizar la semántica de copia probada, separando plantillas privadas de eventos activos.
- Mantener autorización en profundidad: HTTP, RPC y RLS.
- Preservar la interfaz visual actual, reorganizándola para priorizar nombre y dos colecciones operativas.

**Non-Goals:**

- Renombrar internamente `package` a `event` o cambiar `/packages`.
- Crear plantillas públicas, compartidas, oficiales o comercializables.
- Introducir CRM, agenda, pagos, colaboración o recomendaciones automáticas.
- Añadir dependencias, nuevos tipos de evento de dominio o canales Realtime para plantillas.

## Decisions

### 1. `packages` sigue siendo la tabla de eventos

Se añaden `name`, metadatos opcionales y nulabilidad a `space_type`/`capacity_m2`. Los paquetes existentes reciben un nombre determinista, por ejemplo `Evento <id-corto>`, antes de imponer `name NOT NULL` y su restricción de longitud. IDs, FKs, rutas y contratos de eventos técnicos permanecen estables.

Alternativa descartada: crear una tabla `events` y migrar relaciones. Duplicaría el agregado y obligaría a cambiar presupuesto, outbox, Realtime, enlaces y múltiples repositorios sin valor visible.

### 2. Plantillas como snapshot normalizado separado

Se crean `event_templates`, `event_template_groups` y `event_template_items`. La cabecera contiene propietario, nombre, preferencias y datos espaciales reutilizables; deliberadamente no tiene cliente, fecha ni lugar. Los ítems referencian módulos del catálogo y los grupos conservan la jerarquía de hasta tres niveles.

Alternativa descartada: marcar filas de `packages` con `is_template`. Mezclaría eventos vivos con recetas, facilitaría fugas en listados/presupuesto y haría ambiguas las reglas de metadatos y borrado.

### 3. Dos RPC de copia transaccional

`create_event_template_from_package(source_package_id, owner_id, name)` bloquea el evento fuente para lectura consistente y copia configuración con IDs nuevos. `create_package_from_event_template(template_id, owner_id, event_name)` bloquea la plantilla, crea el evento sin cliente/fecha/lugar y copia configuración con IDs nuevos. Ambas validan propietario dentro de la transacción, tienen `SECURITY INVOKER`, `search_path = ''`, privilegio exclusivo de `service_role` y revierten ante cualquier error.

La lógica de mapeo padre-hijo seguirá el patrón existente de `clone_package`. La plantilla conserva tipo de espacio y área si existen porque son parte de la configuración reutilizable; cliente, fecha y lugar nunca entran en tablas de plantilla.

Alternativa descartada: encadenar inserciones desde TypeScript. No garantiza atomicidad y amplía el período de inconsistencia.

### 4. Capacidad pasa de invariantes a diagnóstico

`PaqueteDecoracion` acepta tipo de espacio y capacidad ausentes y deja de rechazar componentes por exceso. Sigue calculando área requerida mediante Composite. Aplicación expone un diagnóstico derivado `pending | compatible | exceeded`, con medidas nullable. Los casos de uso de agregar y agrupar eliminan solo el rechazo `package.capacity_exceeded`; conservan límites de cantidad, jerarquía, ciclos, existencia y concurrencia.

Alternativa descartada: capturar el error de capacidad únicamente en HTTP. El dominio seguiría contradiciendo el comportamiento y otras entradas continuarían bloqueando.

### 5. Contratos HTTP compatibles y recursos de plantilla explícitos

`POST /api/packages` cambia a `{name}` obligatorio más metadatos opcionales. `PATCH /api/packages/{packageId}` actualiza metadatos sin tocar configuración. GET y detalle incorporan nombre, metadatos y diagnóstico espacial. Se mantienen las rutas de ítems, grupos, presupuesto, clon y detalle.

Plantillas usan `/api/event-templates`: GET/POST desde evento; `/api/event-templates/{templateId}` para GET/PATCH/DELETE; `/api/event-templates/{templateId}/instantiate` para crear evento. Los controladores traducen ausencia y recurso ajeno al mismo 404. No se extiende el contrato de outbox: guardar o instanciar snapshots no representa agregar/quitar módulos de un evento existente.

Alternativa descartada: ocultar plantillas bajo `/api/packages/{id}/clone`. La semántica, ciclo de vida y autorización son recursos distintos.

### 6. Autorización y lecturas privadas

RLS permite `SELECT` autenticado solo cuando `auth.uid() = user_id` en eventos y plantillas; tablas dependientes validan propiedad vía cabecera. No se conceden escrituras directas a `anon` ni `authenticated`. Route Handlers obtienen el usuario con `getUser()`, comprueban propiedad con lectores server-side y solo después invocan repositorios/RPC con service role. Listar plantillas filtra por propietario aunque RLS también aplique.

Alternativa descartada: depender solo de RLS o solo de TypeScript. La defensa doble es una restricción explícita y reduce el impacto de errores de composición.

### 7. Experiencia operativa sobre `/packages`

La página conserva el lenguaje visual cobre/papel y la ruta existente, pero reemplaza el formulario espacial por creación rápida centrada en nombre. Presenta primero "Eventos" y después "Plantillas", cada sección con estado vacío, error y acciones contextuales. El configurador muestra edición progresiva de metadatos, diagnóstico espacial y "Guardar como plantilla". Formularios modales o paneles usan elementos nativos, foco inicial, retorno de foco, errores inline y región `aria-live`.

Alternativa descartada: introducir `/events` y redirigir. Añade migración de navegación sin mejorar el flujo MVP.

### 8. Adaptadores separados, agregado técnico compartido

Se amplían puertos/DTO/use cases de packages para eventos y se añade un puerto de repositorio/lector de plantillas dentro del módulo existente. Infraestructura implementa lectores y RPC sin importar aplicación desde interfaz. `ConfiguracionEvento` y pruebas se ajustan a datos espaciales opcionales y copia Composite; no se crea otro árbol de clases paralelo.

## Risks / Trade-offs

- [El término interno `package` difiere de la UI] → Documentar el mapeo y limitar el vocabulario visible a componentes y mensajes de usuario.
- [Cambiar invariantes de capacidad afecta pruebas históricas] → Reemplazar expectativas de 422 por persistencia más diagnóstico; conservar pruebas de validación de números inválidos.
- [Borrado de módulos del catálogo referenciados por plantillas] → Mantener la misma política de integridad usada por `package_items`; no implementar snapshots de activos en este cambio.
- [RPC duplicadas pueden divergir de `clone_package`] → Extraer una función SQL privada solo si reduce duplicación sin cambiar privilegios; cubrir ambos sentidos y rollback con PGlite.
- [Migración `NOT NULL` puede bloquear datos existentes] → Backfill determinista antes de la restricción y prueba con fixture pre-migración.
- [La tarea abarca datos, seguridad y UI] → Implementar por cortes verticales verificables: evento mínimo, metadatos/diagnóstico, plantillas, UI/E2E.

## Migration Plan

1. Aplicar migración aditiva: añadir columnas nullable, backfill de nombres, relajar restricciones espaciales, crear tablas de plantillas, índices, triggers, RLS y RPC.
2. Desplegar código server-side compatible con filas migradas y contratos ampliados.
3. Desplegar la interfaz que crea por nombre y consume plantillas.
4. Ejecutar pruebas PGlite de migración, RLS, copia y rollback; luego smoke E2E live con dos usuarios.
5. Rollback de aplicación: la versión anterior puede leer IDs y configuración, pero no eventos sin datos espaciales. Por ello, después de crear eventos mínimos el rollback operativo debe restaurar primero una versión que tolere NULL; no se eliminarán columnas ni plantillas automáticamente. La reversión de esquema se limita a un entorno sin datos nuevos o a una migración explícita de conservación.
