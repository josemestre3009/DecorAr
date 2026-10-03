# Design

## Context

DECOR-38 introduce el primer flujo que atraviesa todas las capas de Clean Architecture. Hasta ahora el repositorio tiene los clientes de Supabase, un `Result` en `src/shared/domain/result.ts` y los puertos `Clock`, `IdGenerator` y `Logger` en `src/shared/application/ports.ts`, pero ninguno se usa. La autenticación es la oportunidad de conectar esa estructura sin inventar un patrón nuevo.

Las restricciones que fijan el diseño son tres: `docs/Actividad.md` exige casos de uso, entidades y adaptadores visibles en el código; `scripts/scan-architecture.ts` prohíbe que una entrada server-side de App Router importe infraestructura directamente; y `@supabase/ssr` exige que el refresco de sesión ocurra en un middleware.

## Goals / Non-Goals

Goals:

- Un único punto de acceso a la autenticación en código de servidor.
- Casos de uso verificables sin red y sin dobles de Supabase.
- Sesión persistente y refresco en cada navegación.
- Autorización estricta en Route Handlers, independiente de RLS.

Non-Goals:

- Recuperación de contraseña, autenticación multifactor y login social.
- Políticas RLS y configuración de Realtime, que pertenecen a DECOR-36 y a Luis.
- Definición visual definitiva: se reutilizan los tokens existentes.
- Sincronizar o archivar `decor-17-clean-architecture-boundaries`.

## Decisions

### La sesión se expone como un puerto, no como el cliente de Supabase

`createSessionDependencies()` ya existe y hoy devuelve `{ supabase }`, es decir, el cliente crudo. Eso obliga a cada interfaz a conocer la forma de la API de Supabase. Se reemplaza por casos de uso que reciben un `SessionGateway`.

La alternativa era conservar el cliente crudo y añadir sólo un proxy. Se descartó porque habría dejado la lógica de sesión dispersa en cada Server Action, que es exactamente el patrón que `docs/Actividad.md` pide no demostrar.

**Consecuencia:** los casos de uso devuelven `Result` y no lanzan excepciones, de modo que el mapeo de errores a mensajes sea exhaustivo y testeable.

### `SessionGateway` se añade a `ports.ts` y no en un archivo nuevo

`ports.ts` ya existe y está vacío de uso. Añadir el puerto ahí mantiene la convención de un archivo de puertos por contexto compartido y evita un archivo más.

**Alternativa considerada:** `src/shared/application/session-gateway.ts` separado. Descartada por consistencia con `ports.test.ts`, que ya agrupa los contratos compartidos.

### `getClaims()` en el proxy y `getUser()` en los Route Handlers

La documentación oficial de Supabase se contradice: la guía de cliente server-side indica `getClaims()` para refrescar el token, mientras que la plantilla de proxy indica `getUser()`.

Se usan ambos donde corresponde. `getClaims()` valida por JWKS con caché compartida y no hace una llamada de red por petición, que es lo apropiado para mantener la sesión viva. `getUser()` siempre contacta al servidor de autenticación y es lo apropiado antes de ejecutar una operación, porque no depende de que RLS esté configurado.

**Alcance de la afirmación "sin coste de red".** Sólo es cierta con claves de firma asimétricas. El proyecto las usa, y se comprobó consultando `GET /auth/v1/.well-known/jwks.json`, que devuelve una clave `ES256`. Con la clave simétrica heredada (HS256), `getClaims()` recurre a `getUser()` y sí paga una llamada de red por petición. Con claves asimétricas, la única descarga es la del JWKS en el primer acierto de caché, y Supabase lo cachea diez minutos en el edge. Se documenta como una afirmación condicional para que no se lea como una propiedad de la librería.

### Las rutas se protegen por defecto, no por lista
La primera versión declaraba `PROTECTED_PAGE_PREFIXES = ["/packages"]`, la única página protegida que existía en ese momento. Eso hace que la siguiente página nazca pública hasta que alguien recuerde añadirla, que es un fallo latente en lugar de uno visible: el catálogo, el configurador y la experiencia AR están previstos pero todavía no se han construido, así que la regla antigua los habría dejado públicos en su primer commit.

`src/proxy.test.ts` ejercita esas tres rutas por adelantado, antes de que existan, para que la regla quede fijada en el momento en que sus tareas (DECOR-20, DECOR-27 y DECOR-28) las construyan.

Se invierte a `PUBLIC_PAGE_PREFIXES = ["/", "/login", "/signup"]`: todo lo que no esté en esa lista y no sea una ruta de API exige sesión. Una página pública nueva requiere una decisión explícita; una protegida nueva no requiere ninguna.

**Consecuencia aceptada:** una ruta inexistente devuelve una redirección al inicio de sesión en lugar de un 404 para quien no tiene sesión. Se prefiere no revelar qué rutas existen. `/api` sigue exenta porque un cliente HTTP espera `401` en JSON y sus Route Handlers validan la identidad por su cuenta.

### La revalidación vive en una frontera del grupo de rutas, no en cada página
`getClaims()` valida la firma del token, así que un token todavía vigente puede atravesar el proxy aunque la sesión se haya cerrado en otro dispositivo. Detectar eso exige `getUser()`, y pedirlo en cada página es una regla que cada página nueva puede olvidar.

`src/composition/session-guard.ts` expone `getCurrentSessionUser()` y `requireSessionUser()`, ambos envueltos en `cache()` de React para que el layout y la página compartan una sola llamada `getUser()` por navegación. El layout de `(protected)/` los invoca, de modo que el grupo entero hereda la comprobación y cada página nueva queda protegida sin escribirla.

**Alternativa considerada:** una función `requireSession()` que cada página llame explícitamente. Se descartó porque reproduce el problema que se quería evitar: la protección depende de que cada página la recuerde. El coste es un layout más y una convención de grupos, que `src/app/route-inventory.test.ts` verifica.

### La composición devuelve los casos de uso y nada más
`createSessionDependencies()` exponía `{ supabase, auth }`. Nadie usaba `supabase`, pero dejarlo disponible invitaba a que un Route Handler nuevo leyera cookies con `getSession()` sin validarlas, saltándose `SessionGateway` y el diseño de una sola puerta de acceso. Se devuelve únicamente `{ auth }` y el cliente crudo se queda dentro de la composición.

### Los errores se mapean por código, no por texto
`toFailure()` comparaba `error.message` en inglés. Supabase ofrece `error.code`, estable e independiente del idioma: `email_not_confirmed`, `invalid_credentials`, `email_exists`, `user_already_exists`, `weak_password`, `over_request_rate_limit`. Se consulta primero una tabla de códigos y el texto queda como respaldo para las respuestas que llegan sin código.

**Consecuencia:** una cuenta registrada sin confirmar su correo recibe "Confirma tu correo antes de iniciar sesión" en lugar de un mensaje genérico, que es un recorrido normal del producto. Va a nivel de formulario y no señala un campo, porque el correo introducido es correcto.

**Sobre `email_taken`:** con la confirmación de correo activa, Supabase ofusca el registro duplicado y devuelve éxito sin error, así que el código no es observable en este proyecto. Se conserva el mapeo porque vuelve a ser necesario si se desactiva la confirmación de correo o si la cuenta se creó enlazada a otro proveedor, y se documenta que hoy no se alcanza.

### Se propaga el segundo argumento de `setAll`

En `@supabase/ssr` 0.12, `SetAllCookies` recibe `(cookies, headers)` y la librería entrega `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0` y `Pragma: no-cache` en la primera escritura. La implementación existente declara un solo parámetro, por lo que TypeScript no señala el problema y los encabezados se descartan en silencio.

**Consecuencia y límite conocido:** los encabezados se aplican en `src/proxy.ts` y en los Route Handlers, que construyen la respuesta. Los Server Components y las Server Actions no exponen la respuesta, así que no pueden aplicarlos. Es aceptable porque toda página que use `cookies()` es dinámica en App Router y Next.js no la almacena en caché.

### `src/proxy.ts` queda fuera del escáner de arquitectura

`layerOf("src/proxy.ts")` devuelve `null` y `isServerApp` es `false`, porque el escáner sólo conoce `src/app`, `src/domain`, `src/application`, `src/interfaces`, `src/shared`, `src/infrastructure` y `src/composition`. Ninguna regla se le aplica.

**Consecuencia:** la disciplina del proxy es manual. Se registra explícitamente en `docs/DecorAR.md` para que la ausencia de una comprobación automática no se lea como un descuido.

### El formulario es el primer Client Component del repositorio

No existe ningún archivo con `"use client"`. El formulario necesita estado local para deshabilitar el botón y anunciar el error, así que es inevitable. Se mantiene mínimo: el envío sigue ocurriendo en una Server Action, y el componente cliente sólo gestiona estado de presentación.

**Consecuencia:** la regla `client-server-import-dependencies` se ejercita por primera vez. El componente cliente no importa nada de infraestructura.

### La confirmación de correo permanece activa

El proyecto exige confirmar el correo. `signUp` devuelve `session: null` mientras se espera la confirmación, y ese es un estado de éxito pendiente, no un error.

**Consecuencia:** la interfaz distingue tres estados además del reposo: procesando, pendiente de confirmación y error. El flujo se valida con correo real, pero el servicio de correo integrado tiene una cuota horaria muy baja y es best-effort, así que la automatización E2E no debe depender de él. Las credenciales E2E se confirman por la admin API, cuyo detalle corresponde a DECOR-30.

## Risks / Trade-offs

- **Tokens de refresco de un solo uso.** Dos peticiones simultáneas con la misma sesión vencida hacen que la segunda falle y reciba `session: null`. El proxy lo mitiga porque corre una vez por navegación. Las peticiones paralelas del cliente deben manejar `session: null` con gracia.
- **`httpOnly: false` es obligatorio en la librería.** El token de sesión es legible por JavaScript. No es corregible desde la aplicación y se documenta como trade-off consciente.
- **Dos usuarios con datos separados no se prueba de punta a punta.** Sin RLS sólo se puede probar la separación de identidad. La separación de datos pertenece a DECOR-36.
- **OpenSpec no se valida con el CLI.** El repositorio no declara el CLI y no está instalado, así que `openspec validate --strict` no se ejecuta. La conformidad se comprueba de forma manual contra la estructura de los changes archivados.

## Migration Plan

No hay datos ni estado que migrar. El orden de despliegue es el del propio cambio: primero los artefactos de OpenSpec, después el dominio y los casos de uso, luego los adaptadores y la composición, después el proxy y las rutas, y por último las pruebas. `createSessionDependencies()` cambia de forma y su único consumidor es el Route Handler de módulos, que se crea en el mismo cambio.
