# Design

## Context

DECOR-38 ya cubre la identidad: `SessionGateway.currentUser()` usa `getUser()`, el proxy refresca la sesión y `requireSessionUser()` protege las páginas. Los Route Handlers responden 401 en JSON. DECOR-32 creó `public.packages` y `public.package_items` en deny-all y la outbox en `private.domain_events`. El publicador ya usa Broadcast privado con `service_role`. Este cambio añade la propiedad y la autorización de datos y canales. DECOR-27 construirá los endpoints sobre ella.

Revisión del código de sesión de DECOR-38: es compatible y no requiere cambios. `currentUser()` cae a `null` ante cualquier error, así que falla cerrado. El cliente de sesión usa la clave publicable y las cookies, por lo que las consultas llegan a PostgREST como `authenticated` con `auth.uid()` del usuario, que es lo que las políticas necesitan. El cliente del navegador de `@supabase/ssr` propaga el JWT a Realtime en `INITIAL_SESSION`, `SIGNED_IN` y `TOKEN_REFRESHED`.

## Goals / Non-Goals

**Goals:**

- Comprobación de propiedad reutilizable que no dependa de RLS.
- RLS y permisos mínimos para que un fallo del código no exponga datos ajenos.
- Canal privado por paquete solo para el dueño, y solo el backend publica.
- Evidencia automática de que la service role no llega al cliente.

**Non-Goals:**

- UI de autenticación y sesión SSR (DECOR-38, Mei).
- Endpoints de paquete y Builder (DECOR-27).
- Tabla de eventos procesados y presupuesto (DECOR-33). Este diseño fija dónde vive: en `private`.
- Reintentos y reconciliación (DECOR-31).

## Decisions

### Outbox en schema privado, no deny-all en `public`

DECOR-32 ya creó `private.domain_events`, con el schema revocado para `PUBLIC`, `anon` y `authenticated` y RLS habilitada como segunda barrera. Se mantiene esa opción y se fija como convención para `processed_events` (DECOR-33). PostgREST no expone `private`, y Supabase concede privilegios por defecto en `public`, de modo que una tabla nueva en `public` olvidada sin revocar quedaría expuesta. Con un schema privado, el error por omisión es denegar.

### La propiedad se compara en la aplicación

`AuthorizePackageAccessUseCase` obtiene la identidad con `getUser()` y el dueño con `PackageOwnerReader`, y compara `owner === user.id` en TypeScript. El lector usa el cliente de sesión, así que RLS también filtra la consulta, pero la decisión no depende de ese filtro. La prueba lo demuestra con un lector que devuelve el dueño real a cualquiera, como pasaría con RLS deshabilitada.

Un paquete ajeno responde **404** `package.not_found`, igual que uno inexistente, para no revelar qué identificadores existen. Un identificador que no es UUID también responde 404, sin consultar la base.

Alternativa descartada: confiar en que la RPC `commit_package_change` compare `userId`. Sigue siendo una tercera barrera, pero solo cubre escrituras y se ejecuta con `service_role`.

### Adaptador HTTP en `src/interfaces/packages`

`checkPackageAccess(useCase, packageId, headers)` devuelve `{ok, user}` o `{ok:false, response}` con el envelope `{error:{code,message}}` que ya consume la UI. DECOR-27 lo llama como primera instrucción de cada handler de paquete y solo después usa `createEventOutboxDependencies()`. Un fallo de lectura responde 500 sin detalle y queda en el log del servidor.

### Permisos mínimos

| Objeto | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `public.catalog_modules` | SELECT (RLS: solo `active`) | SELECT (RLS: solo `active`) | todo |
| `public.activate_catalog_module` | — | — | EXECUTE |
| `public.packages` | — | SELECT (RLS: `user_id = auth.uid()`) | todo |
| `public.package_items` | — | SELECT (RLS: paquete propio) | todo |
| schema `private` y `private.domain_events` | — | — | uso / lectura-escritura |
| RPC de outbox | — | — | EXECUTE |
| `realtime.messages` Broadcast | — | SELECT si es dueño de `package:{id}` | publica sin RLS |

El catálogo tenía RLS de lectura, pero heredaba los privilegios por defecto de `public` para escritura, y la RPC de activación era ejecutable por `PUBLIC`. RLS ya bloqueaba la escritura, pero se revoca para que los permisos sean mínimos de verdad.

### Canal privado con RLS sobre `realtime.messages`

Realtime autoriza la unión a un canal privado consultando `realtime.messages` con el rol y el JWT del usuario. La política de SELECT exige `extension = 'broadcast'` y que `realtime.topic()` sea `package:{id}` de un paquete cuyo `user_id` sea `auth.uid()`. No hay política de INSERT, así que ningún cliente, ni siquiera el dueño, puede enviar mensajes, y un `budget.recalculated` falso es imposible. El backend publica con `service_role`, que omite RLS.

`auth.uid()` y `realtime.topic()` se envuelven en `(SELECT …)` para que PostgreSQL los evalúe una vez por consulta.

### Suscripción del navegador

`subscribeToPackageChannel(client, packageId, onEvent, onStatus)` vive en `src/infrastructure/supabase/browser.ts`, la única fábrica que el escáner permite importar desde el cliente. Llama a `realtime.setAuth()` antes de unirse, crea el canal con `private: true`, escucha solo `broadcast`, valida cada mensaje con `parseDomainEvent` y descarta los de otro paquete. Traduce `CHANNEL_ERROR` y `TIMED_OUT` a `denied`. La integración en la UI pertenece a DECOR-21.

### Cómo se prueba que la service role no llega al bundle

Hay dos capas:

1. **Después del build** (ya existía): `scripts/build.mjs` compila con un valor centinela y `scan-client-secrets.mjs` busca ese valor en `.next/static`. Es la prueba concluyente, pero requiere un build.
2. **En `npm test`** (nueva): `scripts/service-role-boundary.test.ts` recorre el grafo de imports de cada módulo `"use client"` y de la fábrica del navegador, y falla si alcanza `admin.ts`, `createAdminClient` o una lectura estática de `process.env.SUPABASE_SERVICE_ROLE_KEY`. También impide que exista una variable `NEXT_PUBLIC_*SERVICE_ROLE*`. Detecta la regresión en segundos y sin build.

### Fixtures A/B

En features anteriores, DECOR-38 creó cuentas efímeras con la admin API (`email_confirm: true`) para no consumir la cuota de correo y las eliminó al terminar. Se reutiliza ese método en `supabase/tests/authorization-ab.integration.test.ts`: crea A y B, un paquete para cada uno, prueba lectura, escritura, RPC y canal, y limpia todo. Es opt-in con `DECOR_RLS_INTEGRATION=1`, porque `docs/DecorAR.md` excluye Supabase local y la prueba escribe en el proyecto alojado.

La verificación determinista de las políticas vive en `supabase/migrations/authorize-packages-and-private-channels.test.ts` y se ejecuta con `npm test` sobre PostgreSQL embebido (PGlite). Replica la superficie mínima de Supabase: roles, `auth.uid()`, `realtime.messages` y `realtime.topic()`, aplica todas las migraciones y ejerce RLS y grants con A, B y anónimo. El fixture opt-in complementa esta simulación contra Auth, PostgREST y Realtime alojados.

## Matriz de autorización

| Recurso / acción | A (dueño) | B (ajeno) | Anónimo | Prueba |
|---|---|---|---|---|
| Contrato del Route Handler de paquete (cableado por DECOR-27) | caso de uso se ejecuta | 404, sin caso de uso | 401, sin consulta | `src/interfaces/packages/package-access.test.ts` |
| Handler con RLS deshabilitada | permitido | 404 | 401 | `authorize-package-access.use-case.test.ts`, `package-access.test.ts` |
| SELECT `packages` / `package_items` | solo los suyos | 0 filas | permiso denegado | PGlite, `authorization-ab.integration.test.ts` |
| INSERT/UPDATE/DELETE de paquetes | denegado | denegado | denegado | PGlite, A/B |
| RPC outbox y activación de catálogo | denegado | denegado | denegado | PGlite, A/B |
| `private.domain_events` | denegado | denegado | denegado | PGlite, `create-event-outbox.test.ts` |
| Unirse a `package:{id}` | aceptado | rechazado | rechazado | PGlite, A/B, `browser.test.ts` |
| Publicar en `package:{id}` | rechazado | rechazado | rechazado | PGlite, A/B |
| Service role en el cliente | — | — | — | `service-role-boundary.test.ts`, escaneo post-build |

## Risks / Trade-offs

- [La política de Realtime depende de `realtime.topic()` y de la autorización de canales privados del proyecto] → Se verificó la lógica en PGlite. El comportamiento real del servidor Realtime solo lo demuestra la prueba A/B opt-in contra el proyecto alojado. Además, el proyecto debe tener desactivado "Allow public access" en la configuración de Realtime, porque si no un canal no privado seguiría abierto.
- [El 404 oculta la diferencia entre ajeno e inexistente] → Es intencional. El registro del servidor no la necesita para el MVP.
- [`currentUser()` responde `null` ante un 429 de Auth] → Ya documentado en DECOR-38. Falla cerrado.

## Migration Plan

Migración aditiva `20261008000000_authorize_packages_and_private_channels.sql`. La reversión borra las tres políticas, revoca `SELECT` a `authenticated` sobre las tablas de paquetes y restaura los permisos previos del catálogo.
