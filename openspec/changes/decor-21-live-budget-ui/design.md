# Design

## Arquitectura y Fronteras

1. **Separación de capas y puertos (Clean Architecture):**
   - El configurador de paquetes no manipula ni calcula precios de presupuesto en el cliente.
   - La UI consume el presupuesto confirmado a través de dos mecanismos complementarios:
     - **Transporte de baja latencia (Realtime Broadcast):** Escucha `packageChannel(packageId)` a través de `subscribeToPackageChannel`, utilizando el cliente browser público de `@supabase/ssr` con `setAuth()` previo.
     - **Transporte duradero de resincronización (HTTP API):** Consume `GET /api/packages/{packageId}/budget` mediante el cliente `BudgetClient`.
   - Inversión de dependencias: `useLiveBudget` y `BudgetTotal` aceptan implementaciones opcionales de `budgetClient` y `subscriber`, permitiendo pruebas unitarias deterministas sin tocar WebSockets ni red real.

2. **Seguridad y autorización en Realtime:**
   - Realtime autoriza la unión al canal privado `package:{packageId}` mediante la política de SELECT sobre `realtime.messages` (DECOR-30).
   - No existe política de INSERT para roles cliente en `realtime.messages`, garantizando que ningún usuario pueda publicar un `budget.recalculated` falso.
   - El cliente browser nunca usa `postgres_changes` ni PostgREST CRUD contra la tabla `budgets`.

3. **Concurrencia, idempotencia y deduplicación:**
   - **Deduplicación por `eventId`:** `useLiveBudget` registra los identificadores procesados en un conjunto `seenEventIds: Set<string>`.
   - **Monotonía de versión:** Si `GET /api/packages/{id}/budget` responde con una `packageVersion` inferior a la que el cliente ya tiene confirmada, se descarta para evitar regresiones. `budget.recalculated` no transporta `packageVersion` por contrato (DECOR-29), así que el evento marca la versión conocida de forma monótona (nunca hacia atrás); la comparación por versión solo aplica a las respuestas de resync.
   - **Detección de huecos:** Si `budget.packageVersion < packageVersion`, se detecta un desfase y se invoca la resincronización automática. El aviso de recálculo se mantiene hasta que la versión confirmada alcanza la del paquete.
   - **Cliente estable:** el `BudgetClient` por defecto se instancia una sola vez por montaje para no recrear la suscripción Realtime en cada render.

4. **Tolerancia a fallos y resincronización reactiva:**
   - Se registran listeners para:
     - `window.addEventListener("online")`
     - `document.addEventListener("visibilitychange")` (cuando `document.visibilityState === "visible"`)
     - Reconexión del socket (cuando `status` transiciona a `"subscribed"` tras `"closed"` o `"denied"`)
   - Ante errores de conexión o HTTP 500, se mantiene visible el último total confirmado en `budget` y se despliega una advertencia no bloqueante con acción de `Reintentar`.

5. **Accesibilidad (a11y):**
   - El total confirmado y los mensajes de estado se anuncian a tecnologías de asistencia mediante `aria-live="polite"` y `role="status"` o `role="alert"`.
