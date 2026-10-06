# Spec Delta

## Purpose

Define el recorrido móvil inicial de DecorAR: portada, definición del espacio, creación del paquete y consulta del catálogo, consumiendo únicamente Route Handlers de Next.js.

## ADDED Requirements

### Requirement: Llamada a la acción en la portada
La portada SHALL ofrecer un enlace "Crear mi paquete" hacia `/packages`, y el proxy SHALL redirigir a `/login` a quien lo siga sin sesión.

#### Scenario: Persona sin sesión
- **WHEN** una persona sin sesión pulsa "Crear mi paquete"
- **THEN** llega a `/login`

### Requirement: Definición del espacio
La pantalla `/packages` SHALL pedir el tipo de espacio entre `casa`, `aireLibre` y `salonSocial`, y la capacidad en metros cuadrados como número positivo y finito, antes de crear el paquete.

#### Scenario: Capacidad inválida
- **WHEN** la persona envía una capacidad que no es un número mayor que 0
- **THEN** el formulario no llama a la API, marca el campo con `aria-invalid`, anuncia el error con `role="alert"` y conserva lo escrito

#### Scenario: Solo se aceptan valores numéricos
- **WHEN** la capacidad está vacía, solo tiene letras, mezcla números con otros caracteres (por ejemplo `30m2` o `1e3`), es 0 o negativa, o es tan grande que deja de ser finita
- **THEN** el mensaje explica el caso concreto: "Escribe cuántos metros cuadrados…", "…debe escribirse con números…", "No aceptamos este valor…", "…debe ser mayor que 0" o "…demasiado grande"
- **AND** solo se aceptan dígitos con una parte decimal opcional separada por punto o coma

#### Scenario: Tipo de espacio sin elegir
- **WHEN** la persona envía el formulario sin elegir un tipo de espacio
- **THEN** el formulario anuncia "Elige el tipo de espacio." y no llama a la API

#### Scenario: Creación del paquete
- **WHEN** la persona envía un tipo válido y una capacidad válida
- **THEN** la interfaz llama a `createPackage({spaceType, capacityM2})`, deshabilita el botón mientras espera y navega a `/packages/{id}`

#### Scenario: Error de la API de paquetes
- **WHEN** la API responde un error con envelope `{error:{code,message}}`
- **THEN** la interfaz muestra el mensaje con `role="alert"` y vuelve a habilitar el botón

### Requirement: Consumo de la API de paquetes
La interfaz SHALL crear paquetes y agregar módulos únicamente mediante `POST /api/packages` y `POST /api/packages/{id}/items` (contrato de DECOR-27), o mediante una implementación simulada con la misma forma cuando `NEXT_PUBLIC_DECOR_PACKAGES_API` no sea `live`.

#### Scenario: Modo real
- **WHEN** `NEXT_PUBLIC_DECOR_PACKAGES_API=live`
- **THEN** la interfaz envía `POST /api/packages` con `{spaceType, capacityM2}` y acepta solo un 201 con `{id, spaceType, capacityM2}`

#### Scenario: Modo simulado
- **WHEN** la variable no es `live`
- **THEN** la interfaz responde con la misma forma sin red y muestra el aviso "Modo simulado"

#### Scenario: Sesión terminada
- **WHEN** la API de paquetes responde 401
- **THEN** la interfaz envía a la persona a `/login`

### Requirement: Catálogo del paquete
La página `/packages/{id}` SHALL exigir sesión con `requireSessionUser()` y SHALL mostrar los módulos de `GET /api/modules` como tarjetas con poster, nombre, precio en COP sin decimales, área en m² y botón "Agregar". El navegador SHALL NOT consultar tablas de negocio mediante PostgREST.

#### Scenario: Catálogo con módulos
- **WHEN** `GET /api/modules` responde un arreglo con módulos
- **THEN** cada módulo aparece como una tarjeta, por ejemplo "Mesa redonda", "$ 250.000" y "4 m²"

#### Scenario: Módulo sin imagen
- **WHEN** un módulo tiene `posterUrl` nulo o la imagen no carga
- **THEN** la tarjeta muestra un marcador "sin imagen" con nombre accesible

#### Scenario: Carga
- **WHEN** la respuesta del catálogo todavía no llega
- **THEN** la página muestra "Cargando catálogo…" en una región `role="status"`

#### Scenario: Catálogo vacío
- **WHEN** `GET /api/modules` responde `[]`
- **THEN** la página muestra "Todavía no hay módulos disponibles en el catálogo."

#### Scenario: Error y reintento
- **WHEN** `GET /api/modules` falla
- **THEN** la página anuncia el error sin exponer detalles internos y ofrece "Reintentar", que vuelve a consultar

#### Scenario: Agregar un módulo
- **WHEN** la persona pulsa "Agregar" en una tarjeta
- **THEN** la interfaz llama a `addItem(packageId, moduleId)`, marca ese botón con `aria-disabled` mientras espera sin quitarle el foco, ignora clics repetidos y anuncia el resultado

#### Scenario: Sin acceso directo a PostgREST
- **WHEN** se recorre el flujo completo en el navegador
- **THEN** no se emite ninguna petición a `/rest/v1/`

### Requirement: Uso en móvil
Las pantallas del recorrido SHALL funcionar a 360 px de ancho sin desbordamiento horizontal y con foco visible.

#### Scenario: Recorrido con teclado
- **WHEN** una persona recorre la portada, `/packages` y `/packages/{id}` solo con el teclado
- **THEN** cada control recibe el foco con un contorno visible, y al llegar a `/packages/{id}` el foco pasa al título "Tu paquete"

#### Scenario: Pantalla de 360 px
- **WHEN** la portada, `/packages` o `/packages/{id}` se abren a 360 px
- **THEN** `document.documentElement.scrollWidth` no supera el ancho de la ventana
