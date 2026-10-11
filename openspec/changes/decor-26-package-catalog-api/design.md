# Design

## Arquitectura de la Suite de Integración

1. **Aislamiento y Motor PostgreSQL:**
   - La suite `tests/package-catalog-api.test.ts` utiliza `@electric-sql/pglite` para ejecutar todas las migraciones SQL oficiales de `supabase/migrations` desde cero de forma rápida y determinista.
   - Cada prueba se aísla ejecutando el script server-side `supabase/reset-test-database.sql` en `beforeEach`, garantizando independencia del orden de ejecución.

2. **Verificación de Patrones GoF vía API y Persistencia:**
   - **Builder (DECOR-27):**
     - Fixture 1: Salón social (26 m², 1.300.000 COP, 4 ítems, 4 eventos en outbox).
     - Fixture 2: Paquete básico del Director para aire libre (10 m², 700.000 COP, 3 ítems).
     - Fixture 3: Rechazo por capacidad excedida (32 m² en 30 m²) con HTTP 422 (`package.capacity_exceeded`). Se demuestra que la outbox no registra eventos y la versión del paquete permanece inalterada.
     - Rollback atómico: Ante fallo en transacción SQL (ej. colisión de `eventId`), se revierte atómicamente la inserción de `package_items` y la versión de `packages`.
   - **Prototype (DECOR-24):**
     - `POST /api/packages/{id}/clone` duplica un paquete con nuevos UUIDs en todas sus entidades dependientes, naciendo en `version = 1`.
     - Copia profunda demostrada: Modificar o eliminar un ítem en el clon con `DELETE /items/{itemId}` no altera la persistencia del paquete original.
   - **Composite (DECOR-25):**
     - `POST /api/packages/{id}/groups` crea la *Zona de bienvenida* con arco floral y mesa redonda.
     - Admite hasta 3 niveles de anidamiento; el 4to nivel se rechaza con HTTP 422 (`package.group_depth_exceeded`).
     - Prevención de ciclos: Inmutabilidad de `parent_group_id` y validación de dominio impiden estructuras cíclicas (`package.group_immutable` / `package.group_cycle`).

3. **Seguridad y Ownership A/B (DECOR-30):**
   - Validación de tres perfiles: Anónimo, Usuario A y Usuario B.
   - Solicitudes no autenticadas reciben HTTP 401 (`auth.unauthenticated`).
   - El Usuario B intentando mutar o clonar un paquete del Usuario A recibe HTTP 404 (`package.not_found`), evitando la enumeración de recursos existentes.

4. **Observabilidad y Manejo de Errores (Actividad.md 8.17 / 8.18):**
   - Cobertura de códigos 200, 201, 204, 400, 401, 404, 422 y 500 controlado.
   - Propagación y generación de `x-correlation-id`.
   - Respuestas 500 no filtran detalles internos de bases de datos ni stack traces al cliente.
   - Colección ejecutable en `tests/package-catalog-api.http`.
