# Proposal

## Why

El configurador solo ofrece una demostración fija de "Zona de bienvenida", aunque el dominio y la persistencia ya modelan grupos jerárquicos. El decorador necesita administrar zonas reales sin perder atomicidad, autorización, presupuesto, outbox ni la estructura que DECOR-44 copia a plantillas privadas.

## What Changes

- Sustituir la demostración fija por creación inline de zonas vacías, con nombre obligatorio recortado de 1 a 80 caracteres y subzonas de hasta tres niveles.
- Permitir renombrar y mover zonas dentro del mismo evento, rechazando ciclos, descendientes y profundidades inválidas.
- Permitir eliminar una zona mediante una estrategia explícita: mover todo su contenido a la raíz o eliminar atómicamente todo el subárbol y sus módulos.
- Permitir agregar módulos del catálogo directamente a raíz o a una zona, conservando la adición rápida actual a raíz.
- Permitir mover la misma instancia de módulo entre raíz y zonas sin alterar el catálogo.
- Versionar las mutaciones estructurales, mantener outbox y presupuesto correctos para cambios de módulos, y ejecutar operaciones multirregistro mediante RPC PostgreSQL atómicas.
- Exponer únicamente `POST /api/packages/{packageId}/groups`, `PATCH|DELETE /api/packages/{packageId}/groups/{groupId}` y `PATCH /api/packages/{packageId}/items/{itemId}` para estas operaciones.
- Mantener sesión, propiedad, 404 indistinguible, RLS y permisos exclusivos de `service_role`; el navegador no escribirá tablas de negocio directamente.
- Evolucionar "Contenido del evento" y el catálogo con edición progresiva, jerarquía visible, estados completos, retorno de foco y anuncios accesibles.
- Garantizar que las plantillas privadas de DECOR-44 sigan copiando la estructura final de zonas con IDs nuevos e independencia entre origen y destino.
- Actualizar pruebas de dominio, aplicación, HTTP, PGlite, frontend y E2E live, además de documentación de arquitectura y flujo.
- No añadir drag-and-drop, reordenamiento manual, dependencias, tablas paralelas ni rutas adicionales.

## Capabilities

### New Capabilities

- `editable-decorative-groups`: Gestión completa, jerárquica, accesible, autorizada y atómica de zonas y sus módulos dentro de un evento, incluida su conservación en plantillas privadas.

### Modified Capabilities

- `supabase-client-boundaries`: Las nuevas mutaciones de zonas y módulos deben permanecer en Route Handlers server-side y RPC privilegiadas, sin CRUD de tablas de negocio desde el navegador.

## Impact

- Dominio Composite, DTO, puertos y casos de uso bajo `src/modules/packages`.
- Controlador, composición y Route Handlers de grupos e ítems bajo `src/interfaces/packages`, `src/composition` y `src/app/api/packages`.
- Repositorios Supabase, migraciones, RPC, restricciones, RLS, versión, outbox y presupuesto.
- Clientes y componentes del configurador bajo `src/app/(protected)/packages`, conservando rutas técnicas y terminología interna.
- Copias evento↔plantilla introducidas por DECOR-44, sin sobrescribir sus cambios existentes.
- Suites Vitest, PGlite y Playwright; documentación técnica y evidencias de entrega.
- Sin dependencias nuevas ni cambios de nombres de tablas o rutas.
