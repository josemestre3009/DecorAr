# Proposal

## Why

DecorAR no tiene autenticación: cualquier persona puede entrar a la aplicación y las rutas que vinculan el catálogo, el configurador y la experiencia AR todavía no existen, pero se construirán sobre DECOR-38. Sin una sesión persistente y validada en el servidor no hay forma de saber qué usuario posee qué datos, y esa garantía debe quedar fijada antes de que existan las tablas de negocio.

`docs/Actividad.md` exige que Clean Architecture sea visible en el código, con casos de uso, entidades y adaptadores demostrables. La autenticación es el primer flujo que atraviesa todas las capas, así que es también el que fija el patrón que copian DECOR-18, DECOR-19, DECOR-20 y DECOR-39.

## What Changes

- Añadir un puerto `SessionGateway` y los casos de uso de autenticación (`signUp`, `signIn`, `signOut`, `current`) que devuelven `Result` en lugar de propagar excepciones.
- Añadir el adaptador Supabase que implementa el puerto y unificar el acceso a sesión detrás de esa única frontera.
- Añadir `src/proxy.ts` que refresca la sesión en cada navegación y redirige al login cuando una persona sin sesión abre una ruta protegida.
- Añadir las pantallas de registro e inicio de sesión, la acción de cierre de sesión y sus mensajes de estado, incluido el estado "pendiente de confirmación de correo".
- Validar la sesión en los Route Handlers protegidos con `getUser()` y responder 401 en JSON en lugar de redirigir.
- Propagar los encabezados anti-caché que `@supabase/ssr` entrega cuando escribe cookies de sesión, para impedir que una respuesta autenticada sea servida a otra persona por un CDN o proxy inverso.
- Añadir vocabulario de estilos de formulario en tokens existentes, sin alterar las clases actuales.
- Extender la base de pruebas E2E para reutilizar una sesión autenticada.

## Capabilities

### New Capabilities

- `auth-session-lifecycle`: Registro, inicio y cierre de sesión con sesiones persistentes en cookies, refresco de sesión por petición y protección de rutas de página y de API.

### Modified Capabilities

- `supabase-client-boundaries`: El cliente de sesión server-side pasa a propagar los encabezados anti-caché que la librería entrega junto a las cookies de autenticación.
- `application-foundation`: La base de pruebas de navegador puede reutilizar una sesión autenticada entre escenarios.

## Impact

- Modifica `src/shared/application/ports.ts`, `src/composition/server.ts`, `src/infrastructure/supabase/server.ts`, `src/app/globals.css` y `playwright.config.ts`.
- Añade `src/shared/domain/session.ts`, `src/shared/application/auth.ts`, `src/infrastructure/supabase/session-gateway.ts`, `src/proxy.ts` y las rutas bajo `src/app/(public)`, `src/app/(protected)` y `src/app/api/session`.
- No añade dependencias npm, migraciones, políticas RLS ni configuración de Realtime, que permanecen fuera de alcance.
- No toca el change de `decor-17-clean-architecture-boundaries` ni las especificaciones principales: los requisitos se aplican al archivar.
