# Design

## Context

DECOR-34 requiere una suite formal para certificar la integración de las tareas Luis 1/6 a 5/6 (DECOR-29, DECOR-30, DECOR-31, DECOR-32, DECOR-33) demostrando que:
1. Ningún fallo genera pérdida silenciosa ni doble total.
2. La seguridad negativa pasa en todos los niveles (tablas públicas, esquemas privados, canales Realtime y cliente del navegador).
3. La concurrencia entre drainers no duplica publicaciones.
4. La recuperación restaura la consistencia sin efectos colaterales.

## Goals / Non-Goals

**Goals:**
- Suite repetible y autónoma ejecutable vía Vitest con `@electric-sql/pglite`.
- Implementación de la matriz explícita de pruebas requerida en DECOR-34.
- Validación de atomicidad (paquete+outbox, budget+processed).
- Validación de idempotencia y resistencia a desorden y versiones desconocidas.
- Validación de seguridad negativa para usuarios A, B y anónimo.
- Demostración de drenado concurrente seguro y recuperación / reconciliación.

**Non-Goals:**
- Pruebas E2E en dispositivo móvil (DECOR-39).
- Pruebas de API completa de paquetes (DECOR-26).
- Pruebas de carga o benchmarking de rendimiento.

## Decisions

### 1. Ejecución con PGlite en entorno Node
Se utiliza `@electric-sql/pglite` aplicando secuencialmente todas las migraciones presentes en `supabase/migrations/*.sql` sobre un shim estándar de roles y funciones de Supabase (`anon`, `authenticated`, `service_role`, `auth.uid()`, `realtime.topic()`). Esto proporciona fidelidad con PostgreSQL sin latencia de red ni riesgo de ensuciar datos externos.

### 2. Matriz explícita de fixtures
La suite instancia:
- **Usuarios:** Usuario A (`USER_A`), Usuario B (`USER_B`), y rol `anon`.
- **Paquetes:** Paquete A (propiedad de A), Paquete B (propiedad de B).
- **Módulos:** Módulo de catálogo activo con precio y dimensiones definidas.
- **Eventos:**
  - Evento v1 válido (`package.module.added`).
  - Evento duplicado (mismo `eventId`).
  - Evento con versión de contrato desconocida (`schemaVersion: 99`).
  - Eventos pendientes en `private.domain_events`.

### 3. Verificación de seguridad negativa y estática
- Se valida que `anon` y `authenticated` no tengan permisos sobre el esquema `private` ni sobre las funciones RPC internas (`process_budget_event`, `commit_package_change`, `reconcile_budget`, `claim_*`).
- Se valida la política RLS en `realtime.messages` asegurando que Usuario B no pueda suscribirse al canal `package:{packageId_A}` ni nadie publicar en él directamente.
- Se integra la comprobación estática de frontera de navegador (análoga a `service-role-boundary.test.ts`), garantizando que ningún componente cliente acceda a credenciales de `service_role`.

### 4. Concurrencia y Fallo
- PGlite expone una única conexión y serializa las consultas, por lo que no puede reproducir concurrencia real entre conexiones. La suite verifica dos reclamos sucesivos de `claim_initial_domain_events` sobre un lote que se reparten sin solaparse, y comprueba estructuralmente que la definición SQL conserva `FOR UPDATE SKIP LOCKED` (el mecanismo que evita duplicados en producción). La concurrencia real multi-conexión queda fuera del alcance de PGlite.
- Se prueba la degradación y reintento: publicación fallida permanece en `pending`; 3er fallo consecutivo transiciona a `failed`; la reconciliación vía `reconcile_budget` recalcula y subsana la desviación sin duplicar el total.
