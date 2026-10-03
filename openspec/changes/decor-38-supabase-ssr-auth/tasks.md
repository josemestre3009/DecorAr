# Tasks

Cada tarea indica el comando de verificación con el que se comprueba. El proyecto expone `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`; `npm run build` ejecuta además el escaneo de secretos con valores centinela.

Estado de la entrega: secciones 1 a 10 implementadas. Queda pendiente la validación manual de los escenarios que dependen de una cuenta confirmada en el proyecto Supabase.

## 1. Dominio y contratos

- [x] 1.1 Añadir `SessionUser` en `src/shared/domain/session.ts` como tipo mínimo con `id` y `email`.
- [x] 1.2 Añadir `SessionGateway` a `src/shared/application/ports.ts` sin dependencias de infraestructura.
- [x] 1.3 Extender `src/shared/application/ports.test.ts` con el contrato del puerto.
- [x] 1.4 Verificar: `npm run typecheck` y `npm test`

## 2. Casos de uso

- [x] 2.1 Crear `src/shared/application/auth.ts` con `signUp`, `signIn`, `signOut` y `currentUser`, devolviendo `Result`.
- [x] 2.2 Mapear los fallos de Supabase a un error de dominio legible, sin filtrar detalle técnico al usuario.
- [x] 2.3 Distinguir el registro pendiente de confirmación como estado de éxito, no como error.
- [x] 2.4 Añadir `src/shared/application/auth.test.ts` con un doble en memoria de `SessionGateway`, sin red.
- [x] 2.5 Verificar: `npm test -- src/shared/application/auth.test.ts`

## 3. Adaptador e infraestructura

- [x] 3.1 Crear `src/infrastructure/supabase/session-gateway.ts` implementando `SessionGateway`.
- [x] 3.2 Propagar el segundo argumento de `setAll` en `src/infrastructure/supabase/server.ts` y acumular los encabezados para la respuesta.
- [x] 3.3 Añadir `src/infrastructure/supabase/session-gateway.test.ts` con el cliente de Supabase simulado.
- [x] 3.4 Añadir `src/infrastructure/supabase/server.test.ts` para el segundo parámetro de `setAll`, el almacén de sólo lectura y la escritura de cookies.
- [x] 3.5 Verificar: `npm test -- src/infrastructure` y `npm run typecheck`

## 4. Composición

- [x] 4.1 Modificar `createSessionDependencies()` en `src/composition/server.ts` para devolver los casos de uso además del cliente de sesión.
- [x] 4.2 Verificar: `npm test -- scripts/scan-architecture.test.ts`

## 5. Proxy

- [x] 5.1 Crear `src/proxy.ts` con el patrón de `@supabase/ssr`: cliente por petición, `getClaims()` para forzar la inicialización y reescritura de la respuesta en `setAll`.
- [x] 5.2 Aplicar los encabezados anti-caché a la respuesta.
- [x] 5.3 Redirigir a `/login` las rutas protegidas sin sesión y conservar públicas la portada, el registro, el login y las APIs de salud y autenticación.
- [x] 5.4 Añadir `src/proxy.test.ts` para las rutas públicas, la redirección y la propagación de cookies y encabezados.
- [x] 5.5 Verificar: `npm test -- src/proxy.test.ts`

## 6. Rutas y Server Actions

- [x] 6.1 Crear `src/app/actions.ts` con las Server Actions de registro, inicio y cierre de sesión. Vive fuera de `(public)` porque un módulo `"use server"` sólo puede exportar funciones asíncronas, y el estado inicial compartido necesita ser un valor.
- [x] 6.2 Crear `src/app/(public)/login/page.tsx` y `src/app/(public)/signup/page.tsx`.
- [x] 6.3 Crear `src/app/(public)/auth-form.tsx` como primer Client Component, con botón deshabilitado durante el envío y errores asociados por `aria-describedby`.
- [x] 6.4 Añadir `src/app/(protected)/packages/page.tsx` como destino protegido.
- [x] 6.5 Crear `src/app/api/session/route.ts` que valide con `getUser()` y responda 401 en JSON. La ruta es `/api/session` y no `/api/modules` porque el contrato del catálogo, su envelope de errores y su fixture pertenecen a DECOR-20, DECOR-27 y DECOR-28.
- [x] 6.6 Añadir `src/app/actions.test.ts` para el mapeo de errores y el estado de confirmación pendiente.
- [x] 6.7 Verificar: `npm test`, `npm run lint` y `npm run typecheck`

## 7. Estilos

- [x] 7.1 Añadir en `src/app/globals.css` estilos de `input`, `label`, `button`, `:disabled` y `:focus-visible` con los tokens existentes, sin alterar las clases actuales.
- [x] 7.2 Comprobar que el formulario no desborda horizontalmente a 360 px.
- [x] 7.3 Verificar: `npm run lint` y aserciones de ancho y de atributos ARIA en `e2e/auth.spec.ts`

## 8. Pruebas de navegador

- [x] 8.1 Extender `playwright.config.ts` para aceptar `DECOR_E2E_BASE_URL` y apuntar a un servidor ya levantado, porque Next rechaza un segundo servidor de desarrollo en el mismo directorio.
- [x] 8.2 Añadir `e2e/auth.spec.ts` con el recorrido de rutas protegidas, validación, asociación de errores, respuesta 401 de la API, inicio de sesión, persistencia tras recargar, cierre de sesión y confirmación de correo, más el estado de envío, el foco visible con `Tab` y el ancho a 360 px de `/login` y `/signup`.
- [x] 8.3 Omitir los escenarios autenticados cuando las credenciales no estén configuradas, para no depender del correo de confirmación.
- [x] 8.4 Verificar: `npm run test:e2e`

Desviación registrada durante el cierre: el escenario que decía comprobar que el botón se deshabilitaba durante el envío sólo miraba el estado final, ya habilitado, y por tanto no demostraba lo que su nombre afirmaba. Se sustituyó por uno que retiene la Server Action con `page.route` y observa el botón deshabilitado y su rótulo con la petición en vuelo.

Desviación respecto a la planificación inicial: no se usa `storageState`. Cada escenario autenticado inicia sesión a través del formulario real, lo que además demuestra el recorrido de UI que exige DECOR-38, y evita mantener un artefacto de sesión en disco.

Variables de entorno para los escenarios autenticados:

| Variable | Uso |
|---|---|
| `DECOR_E2E_EMAIL` | Correo de una cuenta ya confirmada. |
| `DECOR_E2E_PASSWORD` | Contraseña de esa cuenta. |
| `DECOR_E2E_ALLOW_SIGNUP` | `1` habilita el registro, que consume la cuota del servicio de correo. |
| `DECOR_E2E_BASE_URL` | Servidor ya levantado; si se omite, Playwright levanta el suyo en el 4173. |

## 9. Cierre

- [x] 9.1 Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` completos.
- [x] 9.2 Confirmar que el escaneo de secretos del build no encuentra la service role en los artefactos del navegador.
- [x] 9.3 Registrar en `docs/DecorAR.md` la nueva sección 2.2.2 con los límites conocidos de la sesión SSR.
- [x] 9.4 Validar manualmente el registro, el inicio de sesión, el cierre de sesión y la persistencia tras recargar. Hecho por Mei con una cuenta real: entró a `/login`, pasó a `/signup`, se registró, inició sesión, comprobó que `/packages` mostraba su correo, recargó sin perder la sesión y cerró sesión.
- [x] 9.5 Validar manualmente "Token de acceso expirado" y "Sesión terminada en otro dispositivo". No se automatizan: dependen del tiempo de vida del token configurado en el proyecto y de una segunda sesión real, así que corresponden a una comprobación manual en el navegador. Hecho por Mei en el navegador.
- [x] 9.6 Registrar que "Dos personas con cuentas distintas no pueden verse los datos" no es verificable en esta entrega: es RLS, de DECOR-30 (Luis), y el propio enunciado de DECOR-38 lo lista en "Fuera de alcance".

Queda entregado para validación del equipo, sin tocar el proyecto Supabase. Los tres escenarios autenticados de `e2e/auth.spec.ts` se omiten si no se configuraron credenciales. Con una cuenta ya confirmada basta con:

```bash
DECOR_E2E_EMAIL=tu-correo DECOR_E2E_PASSWORD=tu-contrasena npm run test:e2e
DECOR_E2E_ALLOW_SIGNUP=1 npm run test:e2e   # consume cuota del servicio de correo
```

### Evidencia de la verificación automática

```text
npm run typecheck  sin errores
npm run lint       sin errores ni advertencias
npm test           13 archivos, 136 pruebas
npm run build      exit 0, escaneo de secretos superado en 10 artefactos
                   /login y /signup estáticas, /packages y /api/session dinámicas
                   ƒ Proxy (Middleware)
npm run test:e2e   16 pruebas
                   sin credenciales: 13 pasan y 3 se omiten
                   con credenciales: 15 pasan y 1 se omite (el de registro,
                   que consume la cuota del servicio de correo)
```

Tres desviaciones se registraron y corrigieron durante el cierre:

1. El escenario de la API con sesión usaba el fixture `request`, que tiene su propio almacén de cookies y por tanto enviaba la petición sin sesión. Fallaba con `401` siempre que se ejecutaba de verdad; no se detectó antes porque el escenario estaba siempre omitido. Ahora usa `page.request`, que comparte el almacén con el navegador.
2. `fullyParallel` se desactivó. Los escenarios autenticados comparten una cuenta real contra Supabase y, en paralelo, el proveedor limita las peticiones y la validación de sesión se vuelve intermitente. Verificado con tres corridas consecutivas en verde.
3. El escenario que decía comprobar el botón deshabilitado durante el envío sólo miraba el estado final, ya habilitado. Se sustituyó por uno que retiene la Server Action con `page.route`.

### Criterios cubiertos por la verificación automática

- "Ruta protegida sin sesión": redirección comprobada con y sin credenciales de prueba.
- "Pantallas públicas": portada, login y registro accesibles sin sesión.
- "API protegida con sesión válida": `401` en JSON sin sesión, con la identidad validada en el servidor.
- "Credenciales incorrectas" y "Registro pendiente de confirmación": cubiertos en `src/app/actions.test.ts` y `src/shared/application/auth.test.ts` sin depender de la red.
- "Envío en curso": la Server Action se retiene con `page.route` para observar el botón deshabilitado y el rótulo de procesando con una petición real en vuelo, y su recuperación al responder.
- "Foco visible": se recorre el formulario con `Tab` real y se comprueba el `outline` calculado de cada control, en lugar de conformarse con leer la regla CSS.
- "Pantalla estrecha": ausencia de desbordamiento horizontal a 360 px comprobada en `/login` y en `/signup`.
- "Escritura de cookies de sesión con respuesta disponible": encabezados y cookies aplicados en `src/proxy.test.ts` y `src/infrastructure/supabase/server.test.ts`.
- Ausencia de service role en los artefactos del navegador.

### Estado de cada criterio

| Criterio | Estado | Evidencia |
|---|---|---|
| Una persona puede registrarse, iniciar sesión y cerrar sesión | Comprobado | Manual de Mei (9.4) y `e2e/auth.spec.ts` con cuenta real |
| La sesión se conserva al recargar | Comprobado | Manual de Mei (9.4) y `e2e/auth.spec.ts` con cuenta real |
| Una ruta protegida redirige al login sin sesión | Comprobado | `e2e/auth.spec.ts` y `src/proxy.test.ts` |
| Dos cuentas distintas no pueden verse datos | Fuera de alcance | RLS y fixtures A/B pertenecen a DECOR-30 (9.6) |
| El botón se deshabilita durante el envío | Comprobado | `e2e/auth.spec.ts` con la Server Action retenida |
| Etiquetas, foco visible y errores asociados | Comprobado | `e2e/auth.spec.ts` con `Tab` real y `getComputedStyle` |
| Las pantallas funcionan a 360 px | Comprobado | `e2e/auth.spec.ts` sobre `/login` y `/signup` |
| Expiración del token de acceso | Comprobado | Manual de Mei en el navegador (9.5) |
| Cierre de sesión en otro dispositivo | Comprobado | Manual de Mei en el navegador (9.5) |

### Límites de alcance respetados

- El acceso a las pantallas de autenticación desde la portada pertenece a DECOR-20 ("Portada y CTA"). DECOR-38 no modifica `src/app/page.tsx`.
- El endpoint de referencia vive en `/api/session` y no en `/api/modules`: el catálogo, su envelope de errores y su fixture pertenecen a DECOR-20, DECOR-27 y DECOR-28.

## 10. Correcciones de la revisión de Jose

Las cuatro observaciones de la revisión de Jose (F1 a F4) y sus tres preguntas quedaron resueltas en la misma rama, sin commits intermedios.

- [x] 10.1 Invertir `src/proxy.ts` a `PUBLIC_PAGE_PREFIXES` para que una página nueva nazca protegida en lugar de pública.
- [x] 10.2 Crear `src/composition/session-guard.ts` con `getCurrentSessionUser()` y `requireSessionUser()`, memorizados con `cache()` de React.
- [x] 10.3 Crear `src/app/(protected)/layout.tsx` como frontera única y mover a `packages/page.tsx` la resolución de la identidad.
- [x] 10.4 Añadir `src/composition/session-guard.test.ts` y `src/app/route-inventory.test.ts`, más los casos de `/catalog`, `/configurador` y `/ar` en `src/proxy.test.ts`. Esas tres rutas se fijan por adelantado: todavía no existen como `page.tsx`, las construyen DECOR-20, DECOR-27 y DECOR-28, y la prueba evita que la regla vuelva a dejarlas públicas cuando lleguen.
- [x] 10.5 Añadir `email_not_confirmed` a `AuthFailureCode` y mapear por `error.code` antes que por el texto en inglés, conservando el texto como respaldo.
- [x] 10.6 Añadir `role="alert"` a los errores de campo de `src/app/(public)/auth-form.tsx` y su aserción en `e2e/auth.spec.ts`.
- [x] 10.7 Devolver únicamente `{ auth }` en `createSessionDependencies()` y ajustar el doble de `src/app/actions.test.ts`.
- [x] 10.8 Ajustar el escenario de credenciales incorrectas en el delta spec, porque el fallo no identifica un campo y `aria-describedby` resultaría engañoso.
- [x] 10.9 Verificar: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` y `npm run test:e2e`.

### Respuestas a las preguntas de la revisión

| Pregunta | Respuesta |
|---|---|
| ¿Asimétricas o HS256? | Asimétricas. `GET /auth/v1/.well-known/jwks.json` del proyecto devuelve una clave `ES256`, así que `getClaims()` verifica localmente. La afirmación "sin coste de red" queda documentada como condicional: con HS256 la librería recurre a `getUser()` y sí paga red. |
| La spec pide `aria-describedby` para credenciales incorrectas | Se ajusta la spec, no el código. El fallo no dice si el correo o la contraseña están mal, de modo que atribuirlo a un campo sería engañoso. `aria-describedby` se reserva para los fallos que sí identifican un campo. |
| ¿`email_taken` es observable? | No con la confirmación de correo activa: Supabase ofusca el registro duplicado y devuelve éxito sin error. El mapeo se conserva por si se desactiva la confirmación o la cuenta viene enlazada de otro proveedor, y se documenta que hoy no se alcanza. |

### Evidencia de la verificación automática tras las correcciones

```text
npm run typecheck  sin errores
npm run lint       sin errores ni advertencias
npm test           15 archivos, 149 pruebas
npm run build      exit 0, escaneo de secretos superado en 10 artefactos
                   /login y /signup estáticas, /packages y /api/session dinámicas
                   ƒ Proxy (Middleware)
npm run test:e2e   16 pruebas
                   sin credenciales: 13 pasan y 3 se omiten
                   con credenciales: 15 pasan y 1 se omite (el de registro,
                   que consume la cuota del servicio de correo)
```

Las tres corridas autenticadas se ejecutaron con una cuenta efímera creada por la admin API con `email_confirm: true`, que no consume la cuota del correo, y se eliminó al terminar. Cubren el recorrido completo con el layout de `(protected)/`: inicio de sesión, persistencia tras recargar, cierre de sesión, respuesta 401 sin sesión y respuesta 200 con sesión.
