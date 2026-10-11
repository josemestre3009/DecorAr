# Tasks

## 1. Fixtures y Entorno
- [x] 1.1 Configurar entorno PGlite con shim de roles y funciones Supabase y aplicar todas las migraciones SQL
- [x] 1.2 Inicializar fixtures: Usuario A, Usuario B, Anónimo, Paquete A, Paquete B, módulos de catálogo, eventos válidos/duplicados/inválidos

## 2. Pruebas de Atomicidad e Idempotencia
- [x] 2.1 Verificar atomicidad de `commit_package_change` (paquete + outbox) ante éxito y fallo
- [x] 2.2 Verificar atomicidad de `process_budget_event` (presupuesto + processed_events)
- [x] 2.3 Verificar rechazo idempotente de `eventId` duplicado en outbox y en consumidor
- [x] 2.4 Verificar preservación de total ante eventos desordenados y versiones no soportadas

## 3. Pruebas de Seguridad y Autorización Negativa
- [x] 3.1 Verificar aislamiento A/B/anónimo en `packages`, `package_items` y `budgets`
- [x] 3.2 Verificar bloqueo estricto a esquemas privados (`private.domain_events`, `private.processed_events`)
- [x] 3.3 Verificar denegación de ejecución de RPCs internas a `anon` y `authenticated`
- [x] 3.4 Verificar políticas de Realtime broadcast en `realtime.messages` para canales privados
- [x] 3.5 Verificar límites arquitectónicos del navegador (sin CRUD directo ni imports de service role)

## 4. Pruebas de Concurrencia y Recuperación
- [x] 4.1 Verificar que reclamos de drainers con `claim_initial_domain_events` no duplican eventos (lock `FOR UPDATE SKIP LOCKED` verificado estructuralmente)
- [x] 4.2 Verificar flujo de reintentos, fallo transitorio y transición a `failed` tras agotar intentos
- [x] 4.3 Verificar reconciliación de presupuesto (`reconcile_budget`) corrigiendo desvíos sin doble total

## 5. Integración y Verificación
- [x] 5.1 Ejecutar `npm run lint` y `npm run typecheck`
- [x] 5.2 Ejecutar suite unificada `tests/events-security-recovery.test.ts`
- [x] 5.3 Registrar comentario de progreso en Plane para DECOR-34
