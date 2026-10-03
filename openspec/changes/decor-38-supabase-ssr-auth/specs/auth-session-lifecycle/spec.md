# auth-session-lifecycle Specification

## Purpose

Permite que una persona se registre, inicie y cierre sesión con correo y contraseña, mantenga esa sesión al recargar la aplicación y no acceda al catálogo, al configurador ni a la experiencia AR sin una sesión válida.

## Requirements

### Requirement: Sesión persistente en cookies
La aplicación SHALL mantener la sesión de autenticación en cookies de cliente mediante `@supabase/ssr`, tanto en el navegador como en el servidor, de modo que sobreviva a una recarga de página.

#### Scenario: Sesión tras recargar
- **WHEN** una persona autenticada recarga la página
- **THEN** la aplicación reconoce la misma sesión y no exige volver a iniciar sesión

#### Scenario: Sesión en el cliente de servidor
- **WHEN** código de servidor crea un cliente de sesión
- **THEN** lee y escribe la sesión en las cookies de la solicitud usando la clave pública

### Requirement: Refresco de sesión por petición
La aplicación SHALL refrescar la sesión en cada navegación antes de que se renderice el contenido, mediante `src/proxy.ts`, y propagar al navegador las cookies resultantes.

#### Scenario: Token de acceso expirado
- **WHEN** una persona navega con un token de acceso vencido y un token de refresco válido
- **THEN** la sesión se renueva y la navegación continúa sin credenciales

#### Scenario: Sesión terminada en otro dispositivo
- **WHEN** una persona navega con una sesión que fue cerrada en otro dispositivo
- **THEN** la aplicación descarta la sesión y exige autenticación de nuevo

### Requirement: Protección de rutas de página
La aplicación SHALL proteger por defecto toda ruta de página que no esté declarada como pública, redirigiendo a la pantalla de inicio de sesión cuando una persona sin sesión la abra, y SHALL revalidar la identidad contra el servidor de autenticación en una frontera común a todas las páginas protegidas. La portada y las pantallas de autenticación SHALL permanecer públicas.

#### Scenario: Ruta protegida sin sesión
- **WHEN** una persona sin sesión abre una ruta del catálogo, el configurador o la experiencia AR
- **THEN** es redirigida a la pantalla de inicio de sesión

#### Scenario: Pantallas públicas
- **WHEN** una persona sin sesión abre la portada, el registro o el inicio de sesión
- **THEN** la ruta se renderiza sin exigir credenciales

#### Scenario: Página nueva sin declarar
- **WHEN** se añade una página que no figura en la lista de rutas públicas
- **THEN** exige una sesión válida sin necesidad de modificar el proxy

#### Scenario: Página protegida nueva
- **WHEN** se añade una página dentro del grupo que declara las rutas protegidas
- **THEN** la frontera común valida su identidad y la página no repite la comprobación

#### Scenario: Sesión revocada en otro dispositivo
- **WHEN** una persona navega por una página protegida con un token todavía vigente cuya sesión ya no existe en el servidor de autenticación
- **THEN** es devuelta a la pantalla de inicio de sesión aunque el proxy la haya dejado pasar

### Requirement: Validación de sesión antes de operaciones de API
Los Route Handlers protegidos SHALL validar la identidad con `getUser()` antes de ejecutar una operación y SHALL responder 401 en JSON cuando la validación falle.

#### Scenario: API protegida con sesión ajena
- **WHEN** un Route Handler protegido recibe una petición sin sesión válida
- **THEN** responde 401 en formato JSON y no ejecuta la operación

#### Scenario: API protegida con sesión válida
- **WHEN** un Route Handler protegido recibe una petición con una sesión válida
- **THEN** ejecuta la operación usando el cliente de sesión server-side

### Requirement: Respuesta de error comprensible
La aplicación SHALL mostrar mensajes comprensibles en español cuando el registro o el inicio de sesión fallen, distinguiendo el error de la confirmación de correo pendiente, el de la cuenta sin confirmar y el de la credencial incorrecta.

#### Scenario: Credenciales incorrectas
- **WHEN** una persona inicia sesión con correo o contraseña incorrectos
- **THEN** ve un mensaje comprensible en una región anunciable, sin atribuirlo a un campo concreto porque el fallo no identifica cuál de los dos es incorrecto

#### Scenario: Fallo que identifica un campo
- **WHEN** el fallo señala un campo concreto, como un correo con formato inválido o una contraseña demasiado corta
- **THEN** el mensaje se relaciona con ese campo mediante `aria-describedby` y además se anuncia, porque el foco permanece en el botón tras el envío

#### Scenario: Cuenta sin confirmar
- **WHEN** una persona inicia sesión antes de confirmar el correo con el que se registró
- **THEN** ve un mensaje que le pide confirmar ese correo, no un mensaje genérico de fallo

#### Scenario: Registro pendiente de confirmación
- **WHEN** una persona se registra y el proyecto exige confirmar el correo
- **THEN** ve un mensaje que informa que debe revisar su correo, no un mensaje de error

### Requirement: Formularios accesibles y utilizables
Los formularios de autenticación SHALL tener etiquetas asociadas, foco visible, mensajes de error accesibles, botón deshabilitado durante el envío y SHALL funcionar a 360 px sin desbordamiento horizontal.

#### Scenario: Envío en curso
- **WHEN** una persona envía el formulario
- **THEN** el botón indica que está procesando y permanece deshabilitado hasta que la respuesta llegue

#### Scenario: Pantalla estrecha
- **WHEN** se abre el formulario con un viewport de 360 px
- **THEN** no hay desbordamiento horizontal y todos los controles son alcanzables

### Requirement: Cierre de sesión
La aplicación SHALL ofrecer una acción de cierre de sesión que elimine la sesión del servidor y del navegador.

#### Scenario: Cierre de sesión
- **WHEN** una persona autenticada cierra sesión
- **THEN** la sesión deja de existir y las rutas protegidas vuelven a redirigir al inicio de sesión
