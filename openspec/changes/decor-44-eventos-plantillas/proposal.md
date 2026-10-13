# Proposal

## Why

El flujo actual obliga al decorador a definir espacio y metros cuadrados antes de comenzar y expone el término técnico "paquete" como producto. Esto bloquea solicitudes todavía incompletas y no permite reutilizar configuraciones frecuentes sin duplicarlas manualmente.

## What Changes

- Presentar `/packages` como un espacio de trabajo separado para eventos y plantillas privadas, conservando `package` solo como nombre técnico interno.
- Crear eventos con nombre obligatorio; cliente, fecha, lugar, tipo de evento, tipo de espacio y área disponible serán opcionales y editables después.
- Convertir la validación estricta de capacidad en un diagnóstico informativo: pendiente sin área, compatible o excedida con medidas visibles, sin impedir cambios.
- Guardar la configuración de un evento como plantilla privada sin copiar cliente, fecha ni lugar.
- Crear eventos independientes desde plantillas mediante copia profunda y atómica de módulos, cantidades, zonas, jerarquía y preferencias.
- Restringir todas las operaciones de plantilla a su propietario mediante autorización server-side y RLS sin revelar recursos ajenos.
- Migrar paquetes existentes a eventos con nombre legible, sin pérdida de configuración ni enlaces.
- Actualizar interfaz, contratos HTTP, documentación y pruebas unitarias, de integración, seguridad, migración y E2E.

## Capabilities

### New Capabilities

- `event-management`: Creación, edición, listado y configuración de eventos con metadatos espaciales opcionales y diagnóstico no bloqueante.
- `private-event-templates`: Gestión privada de plantillas y copia profunda, atómica e independiente entre eventos y plantillas.

### Modified Capabilities

- `supabase-client-boundaries`: Las nuevas escrituras de eventos y plantillas deben pasar por Route Handlers y operaciones server-side; el navegador no escribe tablas de negocio.

## Impact

- Dominio y aplicación de `src/modules/packages`, manteniendo el agregado técnico existente y sus patrones Builder, Composite y Prototype.
- Route Handlers, controladores, composición y clientes bajo `src/app/api/packages`, `src/interfaces/packages`, `src/composition` y `src/app/(protected)/packages`.
- Esquema Supabase, migraciones, RPC transaccionales, políticas RLS y lectores/repositorios.
- Contratos y consumidores actuales de paquetes, presupuesto, outbox y Realtime, que conservarán IDs, rutas y compatibilidad.
- Pruebas Vitest/PGlite/Playwright y documentación en `docs/DecorAR.md`, `docs/Actividad.md` y documentación técnica del módulo.
- Sin dependencias nuevas ni renombrado masivo de tablas, rutas o clases internas.
