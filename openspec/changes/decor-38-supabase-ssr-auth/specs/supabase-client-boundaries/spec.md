# Spec Delta

## ADDED Requirements

### Requirement: Encabezados anti-caché en respuestas autenticadas
El cliente de sesión server-side SHALL propagar los encabezados que `@supabase/ssr` entrega junto a las cookies de autenticación, de modo que las respuestas que escriben una sesión no sean almacenadas por un CDN ni por un proxy inverso. Los contextos donde el framework no permite escribir encabezados de respuesta, como los Server Components y las Server Actions, SHALL quedar documentados como una limitación conocida con su justificación.

#### Scenario: Escritura de cookies de sesión con respuesta disponible
- **WHEN** el cliente de sesión escribe cookies de autenticación desde `src/proxy.ts` o desde un Route Handler
- **THEN** la respuesta incluye `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0` y `Pragma: no-cache`

#### Scenario: Sesión escrita desde un Server Component
- **WHEN** el cliente de sesión escribe cookies desde un Server Component o una Server Action
- **THEN** los encabezados no se aplican porque el framework no expone la respuesta, y la limitación queda registrada en la documentación de diseño

### Requirement: Un solo punto de acceso a la sesión
El acceso a la autenticación en código de servidor SHALL concentrarse en un adaptador que implementa un puerto de aplicación, sin llamadas dispersas a la API de sesión desde Server Components, Route Handlers o Server Actions.

#### Scenario: Operation de autenticación desde una interfaz
- **WHEN** una interfaz, una Server Action o un Route Handler necesita registrar, autenticar, cerrar o inspeccionar una sesión
- **THEN** delega en los casos de uso de aplicación y el adaptador de infraestructura implementa el puerto

#### Scenario: La composición no expone el cliente crudo
- **WHEN** se resuelve una dependencia de sesión en la composición del servidor
- **THEN** devuelve únicamente los casos de uso, de modo que ninguna interfaz pueda leer cookies de sesión sin validarlas contra el servidor de autenticación
