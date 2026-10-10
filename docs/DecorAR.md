# DecorAR: Arquitectura y diseño

*Mei Ching – Jose Mestre – Rafael Potes – Luis Silva*

## 1. Contexto del proyecto

DecorAR es una herramienta de realidad aumentada dirigida hacia la planificación visual del adorno de eventos sociales, como celebraciones corporativas, fiestas y matrimonios. El propósito es mitigar la incertidumbre previa a la contratación de una decoración: el usuario tiene la capacidad de seleccionar módulos del catálogo, elaborar un paquete y visualizar los elementos 3D a escala 1:1 en el espacio real a través del dispositivo móvil. En iOS, la experiencia puede abrir AR Quick Look; en Android, Scene Viewer; `<model-viewer>` como capa de integración es compatible con el cliente web.

### 1.1 Problema central del MVP

El presupuesto debe reaccionar de forma casi inmediata a cada cambio del paquete sin acoplar la lógica de selección de módulos a la lógica de cálculo de precios. Ese problema justifica el estilo orientado a eventos y el uso de Publish-Subscribe / Event Bus.

### 1.2 Actores y flujo funcional principal

- Usuario (wedding planner o cliente final): define el espacio, selecciona módulos y consulta el presupuesto.
- Cliente AR web móvil: presenta catálogo, configuración y experiencia 3D/AR.
- Backend DecorAR: valida reglas del paquete, persiste cambios, publica eventos y recalcula el presupuesto.
- Servicios externos: almacenamiento de activos 3D y visores AR nativos del dispositivo.

### 1.3 Alcance de la experiencia AR del MVP

La experiencia AR del MVP detecta una superficie horizontal o vertical compatible y permite al usuario colocar, mover y rotar un elemento decorativo 3D a escala 1:1. El cliente utiliza `<model-viewer>` para abrir WebXR o Scene Viewer en Android y Quick Look en iOS. La escala del modelo debe permanecer fija para representar sus dimensiones reales.

El MVP no escanea una habitación completa, no calcula automáticamente su área disponible, no reconoce todos los muebles u obstáculos y no distribuye automáticamente varios elementos evitando colisiones. Estas capacidades requerirían tecnologías de escaneo espacial dependientes del dispositivo, como ARKit RoomPlan, LiDAR o ARCore Depth, y quedan fuera del alcance de esta entrega.

La validación de capacidad realizada por Builder es independiente de la detección de superficies AR. Los valores de capacidad utilizados en los ejemplos de la sección 4.1 son datos demostrativos para probar el patrón, no capacidades oficiales asociadas a una casa, un salón social o un espacio al aire libre. Cuando se necesite demostrar esta regla, la capacidad se proporciona como dato configurable del paquete.

### 1.4 Decisiones funcionales del MVP

- Capacidad del espacio: el usuario ingresa manualmente los metros cuadrados disponibles al crear el paquete. El valor debe ser positivo y finito. El paquete conserva este valor como referencia para que cambios posteriores no alteren silenciosamente una configuración existente.
- Preferencias clonables: una configuración conserva `estilo`, `colores` y `notas`. Prototype realiza una copia profunda de estos datos y de las colecciones mutables.
- Composite: se permiten hasta tres niveles de grupos y se rechazan ciclos. La demostración mínima usa el grupo "Zona de bienvenida", compuesto por un arco floral y una mesa redonda existentes en el catálogo.
- Autenticación: Supabase Auth con correo electrónico y contraseña. Las pruebas de RLS utilizan al menos dos usuarios para demostrar aislamiento.
- Compatibilidad iOS: los tres módulos iniciales deben disponer de USDZ. Cada activo publica GLB, USDZ y poster en Cloudinary.
- Recuperación de eventos: se realizan como máximo tres reintentos, después de 1, 2 y 4 segundos. Tras agotarlos, el evento permanece pendiente para reconciliación desde PostgreSQL.
- Propiedad del presupuesto: Paquetes persiste elementos y área utilizada y publica eventos. Presupuesto consume los eventos, relee el paquete, calcula y persiste el total confirmado y notifica al cliente.
- Nombres canónicos: `agregarArco`, `PaqueteDecoracionBuilderImpl` y `construirPaqueteBasico`.

### 1.5 Decisiones técnicas del MVP

- Usar la versión estable vigente de Next.js al inicializar el repositorio, con App Router y TypeScript estricto.
- Usar Vitest para pruebas unitarias, de componentes y de integración que no requieran navegador completo.
- Usar Playwright para un flujo integral móvil representativo.
- Guardar valores monetarios en COP como enteros.
- Limitar cada GLB o USDZ a 15 MB, con objetivo de optimización inferior a 10 MB. Limitar posters a 1 MB, con objetivo inferior a 300 KB.
- Usar `ar-scale="fixed"` para conservar escala 1:1.
- Publicar activos Cloudinary con identificadores y versiones inmutables. Un reemplazo crea una nueva versión y se activa en el catálogo sólo después de validarse.
- Empaquetar únicamente la aplicación Next.js en Docker. La imagen de producción usa un build multi-stage, salida standalone de Next.js y un usuario no root. `docker compose` levanta únicamente DecorAR; PostgreSQL, PostgREST, Auth y Realtime se consumen desde el proyecto alojado de Supabase, y Cloudinary permanece externo. El MVP no requiere instalar Supabase CLI, PostgreSQL ni una instancia local de Supabase en los equipos del grupo.

### 1.6 Trazabilidad de decisiones:

| Problema del proyecto | Estilo | Problema derivado | Patrón arquitectónico | Problema de código | GoF |
|---|---|---|---|---|---|
| El presupuesto cambia con cada módulo | Orientado a eventos | Propagar cambios sin llamadas directas | Publish-Subscribe / Event Bus | Construir un paquete válido | Builder |
| Reutilizar configuraciones de eventos similares | Orientado a eventos | La copia debe integrarse al mismo flujo de cambios | Publish-Subscribe / Event Bus | Duplicar configuración sin reconstruirla paso a paso | Prototype |
| Un paquete contiene elementos simples y grupos | Orientado a eventos | Los cambios deben representar agregados de forma uniforme | Publish-Subscribe / Event Bus | Calcular precio/espacio igual para simples y compuestos | Composite |
| La visualización AR cambia según plataforma | Orientado a eventos | El cliente consumidor debe evolucionar sin afectar productores | Publish-Subscribe / Event Bus | Separar elemento decorativo del motor de render AR | Bridge |
| Una escena repite muchas instancias del mismo 3D | Orientado a eventos | Los eventos agregan instancias, no copias pesadas del activo | Publish-Subscribe / Event Bus | Compartir geometría y separar posición/rotación | Flyweight |

## 2. Análisis del estilo arquitectónico

### 2.1 Componentes o dominios relevantes

| Componente | Responsabilidad principal | Evento / interacción relevante |
|---|---|---|
| Paquetes | Construcción incremental del paquete y validación de reglas de espacio. | Publica ModuloAgregado / ModuloEliminado. |
| Presupuesto | Recalcular total y exponer el último valor confirmado. | Consume cambios del paquete. |
| Catálogo | Metadatos de módulos, dimensiones, precio y URL del activo 3D. | Consulta síncrona; no necesita conocer Presupuesto. |
| Event Bus | Distribuir eventos del dominio a consumidores interesados. | Desacopla productor y consumidores. |

### 2.2 Estilo apropiado y su límite en el MVP

El presupuesto en vivo es un requerimiento que responde a cambios de estado, por lo cual se integra bien con una arquitectura enfocada en eventos. El productor tiene la capacidad de anunciar que hubo un cambio sin tener conocimiento de cuál será la reacción de los consumidores. Esto hace más sencillo agregar sugerencias, análisis o notificaciones en el futuro sin tener que cambiar la lógica de los paquetes.

**Decisión de alcance para el MVP:** Los componentes previos son considerados módulos lógicos en lugar de microservicios distribuidos de manera independiente. Mantener únicamente una implementación de backend disminuye la complejidad operativa del semestre, pero mantiene límites definidos y comunicación basada en eventos que agrega valor. Algunos módulos podrían desconectarse sin que el contrato de eventos sea redefinido si el producto crece.

### 2.2.1 Acceso a datos con PostgreSQL y PostgREST

Supabase proporciona PostgreSQL como base de datos y PostgREST como su Data API automática. PostgREST no es un componente adicional que el equipo deba desplegar en Docker. Los adaptadores de infraestructura ejecutados en el servidor Next.js pueden usar `supabase-js`, que consume esta Data API.

El navegador utiliza Supabase únicamente para autenticación y suscripción a canales privados de Realtime. La creación o modificación de paquetes, elementos, presupuestos y eventos se realiza mediante Route Handlers de Next.js, los cuales validan la sesión, invocan casos de uso y delegan la persistencia a adaptadores server-side. Los componentes cliente no realizan CRUD directo con `.from()` sobre estas tablas.

Las credenciales elevadas de Supabase se conservan exclusivamente en el servidor y nunca usan el prefijo `NEXT_PUBLIC_`. RLS constituye una defensa adicional en PostgreSQL y no reemplaza la autorización de los Route Handlers.

Las operaciones que deben modificar varias tablas de forma atómica, como actualizar un paquete y registrar su evento outbox, clonar una configuración completa o guardar un presupuesto junto con el `eventId` procesado, se implementan mediante funciones PostgreSQL invocadas desde el servidor con `supabase.rpc()`. Estas funciones usan `SECURITY INVOKER` por defecto, `search_path` vacío y nombres de objetos completamente calificados. `SECURITY DEFINER` sólo se permite cuando sea imprescindible y debe justificarse, restringir permisos y probarse.

El cliente recibe actualizaciones del presupuesto mediante Broadcast privado de Supabase Realtime. No se exponen directamente cambios de las tablas internas mediante `postgres_changes`.

### 2.2.2 Ciclo de vida de la sesión SSR y límites conocidos

La sesión se resuelve siempre en el servidor. El cliente de Supabase para SSR se crea una vez por petición y se apoya en las cookies de la petición; en el navegador se usa el patrón `getAll`/`setAll`, que exige asignar todas las cookies leídas y no permitir que la petición alive el almacen de cookies del servidor.

El refresco del token ocurre de forma perezosa, cuando un consumer llama por primera vez a la sesión. La validación se reparte según el coste y la fiabilidad de cada punto de entrada:

- `src/proxy.ts` usa `getClaims()`, que verifica la firma del token localmente contra el JWKS del proyecto, para decidir si una página protegida continúa o redirige a `/login`. No redirige las rutas de API porque un cliente HTTP espera un `401` en JSON y no una redirección de navegador.
- `src/app/(protected)/layout.tsx` y las páginas del grupo validan la identidad con `getUser()`, que sí consulta al servidor de autenticación, a través de `requireSessionUser()` en `src/composition/session-guard.ts`. Los Route Handlers hacen lo mismo. `getSession()` no se usa para autorizar, porque leer la cookie no garantiza que el token siga siendo válido.

La validación está repartida en dos niveles a propósito. `getClaims()` es barata y sirve para descartar rápido a quien no tiene sesión, pero un token todavía vigente puede atravesarla aunque la sesión se haya cerrado en otro dispositivo. Por eso cada página protegida llama a `requireSessionUser()`. No basta con el layout del grupo: en Next 16 los layouts no se vuelven a ejecutar en la navegación del cliente y no impiden que la página se ejecute (guía de autenticación de Next, "Layouts and auth checks"). `src/app/route-inventory.test.ts` falla si una página de `(protected)/` omite la llamada. `getCurrentSessionUser()` y `requireSessionUser()` están envueltos en `cache()` de React, de modo que en una carga completa el layout y la página comparten una sola llamada `getUser()`. Las Server Actions que operen en nombre del usuario deben validar la identidad por su cuenta.

El alcance de "sin coste de red" para `getClaims()` es condicional y conviene no leerlo como una propiedad de la librería. El proyecto firma con una clave asimétrica, comprobado sobre `GET /auth/v1/.well-known/jwks.json`, que devuelve una clave `ES256`: en ese caso la única descarga es la del JWKS en el primer acierto de caché, y Supabase lo cachea diez minutos en el edge. Con la clave simétrica heredada (HS256), `getClaims()` recurre a `getUser()` y sí paga una llamada de red por petición.

Las rutas se protegen por defecto, no por lista. `src/proxy.ts` declara `PUBLIC_PAGE_PREFIXES = ["/", "/login", "/signup"]` y trata como protegida cualquier otra ruta de página, de modo que una página nueva nace protegida y sólo queda pública si alguien la añade ahí a propósito. `/api` queda exenta porque sus Route Handlers validan la identidad por su cuenta. La convención de grupos es que toda página se cree dentro de `(public)/` o de `(protected)/`, y `src/app/route-inventory.test.ts` falla si aparece una página fuera de ambos grupos. `/api/health` se atiende en el proxy antes de crear el cliente de Supabase, para que el healthcheck del contenedor no dependa de él.

El cliente server propaga los encabezados `Cache-Control`, `Expires` y `Pragma` que entrega la librería a través del callback `setAll`, y el proxy los adjunta a la respuesta que reenvía.

Límites conocidos que conviene no ocultar:

- El escáner de arquitectura recorre todo el árbol `src/`, pero `src/proxy.ts` queda fuera de las capas que clasifica y `layerOf("src/proxy.ts")` devuelve `null`. El archivo no tiene reglas automáticas que lo protejan y depende de la revisión manual.
- En React Server Components y Server Actions el callback `setAll` no puede fijar encabezados de respuesta, porque ese contexto no dispone de un `NextResponse` que modificar. Las cookies sí se escriben mediante `next/headers`; los encabezados anti-caché están garantizados en el proxy y en los Route Handlers. En las páginas se conserva la marca `ƒ (Dynamic) server-rendered on demand`, de modo que la respuesta no se sirve desde la caché estática de Next.js.
- El cliente browser deja las cookies de sesión legibles desde JavaScript (`httpOnly: false`) y con una vigencia de 400 días, que es lo que exige `@supabase/ssr` para su refresco automático. La Session Access Token y la Refresh Token quedan expuestas ante un XSS.
- La persistencia de la sesión se demuestra en el navegador. El aislamiento de datos entre dos usuarios lo aporta DECOR-30 (sección 2.2.4): Luis crea las políticas y los fixtures, y DECOR-38 aporta la sesión SSR y la UI.
- `currentUser()` no distingue "no hay sesión" de "el proveedor no respondió": cualquier error de `getUser()`, incluido un `429` por límite de peticiones, se traduce en `null` y por tanto en `401`. Es una decisión que falla cerrada, correcta para no conceder acceso, pero produce falsos negativos cuando Supabase está saturado. Por eso `playwright.config.ts` serializa la suite: los escenarios autenticados comparten una cuenta real y en paralelo el proveedor limita las respuestas.
- El proyecto de Supabase exige confirmar el correo y el servicio interno de correo es best-effort con cuota baja. El registro se trata como un éxito pendiente de confirmación, nunca como un fallo, y la entrega del correo no se puede garantizar de forma automatizada.
- Con la confirmación de correo activa, Supabase ofusca el registro duplicado y devuelve éxito sin error, así que el aviso "ya existe una cuenta con ese correo" no es observable en este proyecto: quien se registra con un correo ya usado ve el mensaje de revisar la bandeja. El mapeo del error se conserva por si se desactiva la confirmación o si la cuenta se creó enlazada a otro proveedor, y su prueba unitaria sigue ejercitando el código alcanzable.
- Al proteger por defecto, una ruta inexistente devuelve una redirección a `/login` en lugar de un `404` para quien no tiene sesión. Se acepta como forma de no revelar qué rutas existen.

### 2.2.3 Recorrido móvil inicial y simulación temporal de paquetes

El primer recorrido del cliente (DECOR-20) va de la portada a `/packages`, donde la persona define el tipo de espacio (`casa`, `aireLibre` o `salonSocial`) y la capacidad en metros cuadrados, y de ahí a `/packages/{id}`, que muestra el catálogo. Las dos páginas pertenecen a `(protected)/` y llaman a `requireSessionUser()`. Los componentes cliente sólo hablan HTTP: el catálogo se consulta con `GET /api/modules` y el paquete se crea y se amplía a través del puerto `PackagesClient` (`src/app/(protected)/packages/_lib/packages-client.ts`), con el contrato de DECOR-27: `POST /api/packages` y `POST /api/packages/{id}/items`. El navegador no ejecuta `.from()` sobre tablas de negocio, y la prueba E2E comprueba que no sale ninguna petición a `/rest/v1/`.

Mientras DECOR-27 no esté integrado, `NEXT_PUBLIC_DECOR_PACKAGES_API=simulated` (valor por defecto) activa una implementación que responde con la misma forma y los mismos códigos sin red. La interfaz lo indica con un aviso "Modo simulado". Al integrar DECOR-27 basta con construir con `live`; la implementación HTTP ya está probada contra el contrato.

Límites conocidos de esta etapa:

- En modo simulado el paquete vive en `sessionStorage` de la pestaña: no existe en el servidor, no pasa por RLS y la capacidad no se compara con el área de los módulos, que es responsabilidad del Builder de DECOR-27.
- `GET /api/modules` devuelve `[]` mientras el seed mantenga los módulos en `draft`; la pantalla muestra entonces el estado vacío. Las tarjetas se verifican con el fixture de DECOR-28 servido mediante `page.route`.
- `GET /api/modules` responde sus errores como `{error:"Internal Server Error", correlationId}`, no con el envelope `{error:{code,message}}`, y no exige sesión. La interfaz acepta ambos formatos y nunca muestra el detalle de un `5xx`.
- `NEXT_PUBLIC_DECOR_PACKAGES_API` se fija al compilar: en Docker se pasa como argumento de construcción y hay que reconstruir la imagen para cambiarla.

### 2.2.4 Autorización por propiedad, RLS y canales privados

La autorización tiene tres barreras independientes (DECOR-30):

1. **Route Handler.** DECOR-30 entrega `checkPackageAccess` (`src/interfaces/packages/package-access.ts`) y `createPackageAccessDependencies()`. Todo handler de paquete que añada DECOR-27 deberá llamarlos antes del caso de uso. `AuthorizePackageAccessUseCase` valida la identidad con `getUser()` y compara el dueño en TypeScript, así que la decisión no depende de RLS. Sin sesión responde `401`. Un paquete ajeno o inexistente responde `404 package.not_found`, para no revelar qué paquetes existen.
2. **RLS.** `authenticated` sólo puede leer sus `packages` y `package_items`, y `anon` no tiene permisos. Ningún cliente escribe directamente: las escrituras pasan por `commit_package_change`, que ejecuta `service_role` y vuelve a exigir la propiedad. Las tablas internas (`private.domain_events` y, en DECOR-33, `processed_events`) viven en el schema `private`, que PostgREST no expone.
3. **Realtime.** El navegador sólo se suscribe, con `subscribeToPackageChannel`, al canal privado `package:{packageId}`. Una política sobre `realtime.messages` lo autoriza únicamente al dueño. No existe política de escritura, así que ningún cliente puede publicar un `budget.recalculated` falso: sólo publica el backend.

| Recurso / acción | Dueño (A) | Ajeno (B) | Anónimo |
|---|---|---|---|
| Route Handler de paquete (cableado por DECOR-27) | ejecuta | 404 | 401 |
| Leer paquete y elementos | sus filas | 0 filas | denegado |
| Escribir paquete, RPC de outbox o de catálogo | denegado | denegado | denegado |
| Unirse a `package:{id}` | aceptado | rechazado | rechazado |
| Publicar en `package:{id}` | rechazado | rechazado | rechazado |

Las pruebas negativas cubren cada fila (detalle en `openspec/changes/decor-30-auth-rls-private-channels/design.md`). `supabase/migrations/authorize-packages-and-private-channels.test.ts` aplica todas las migraciones en PGlite y ejecuta las políticas con roles y funciones de Supabase simulados dentro de `npm test`. Los fixtures A/B contra el proyecto alojado son opt-in (`DECOR_RLS_INTEGRATION=1`), porque crean usuarios reales con la admin API y verifican también el servidor Realtime.

La service role se comprueba en dos niveles: `scripts/service-role-boundary.test.ts` recorre el grafo de imports de cada Client Component y falla si alcanza el cliente admin, y el escaneo posterior al build busca su valor centinela en `.next/static`.

Límite operativo: en la configuración de Realtime del proyecto, "Allow public access" debe estar desactivado para que sólo existan canales privados.

### 2.2.5 Vista 3D y realidad aumentada: Bridge y Flyweight

Cada tarjeta del catálogo enlaza a `/packages/{id}/modules/{moduleId}` (DECOR-23). La página está en `(protected)/`, llama a `requireSessionUser()` y obtiene el módulo de `GET /api/modules`. El componente cliente carga `@google/model-viewer` sólo en el navegador y le entrega la configuración que preparan los patrones de las secciones 4.4 y 4.5, implementados en `src/modules/ar/domain` como TypeScript puro.

```mermaid
classDiagram
    class ElementoAR {
        <<abstract>>
        +nombre
        +instancia: InstanciaDecorativa
        +colocacion
        +presentar() ConfiguracionVisor
    }
    class RenderizadorAR {
        <<interface>>
        +soporta(capacidades) bool
        +configurar(peticion) ConfiguracionVisor
    }
    ElementoAR <|-- MesaAR
    ElementoAR <|-- ArcoAR
    ElementoAR <|-- PistaAR
    ElementoAR o--> RenderizadorAR : delega
    RenderizadorAR <|.. RenderizadorQuickLook
    RenderizadorAR <|.. RenderizadorSceneViewer
    RenderizadorAR <|.. RenderizadorWebXR
    RenderizadorAR <|.. RenderizadorSinAR
```

```mermaid
classDiagram
    class FabricaActivos3D {
        -activos: Map
        +obtener(datos) Activo3DCompartido
        +activosCreados
    }
    class Activo3DCompartido {
        <<inmutable>>
        +clave
        +glbUrl
        +usdzUrl
        +posterUrl
        +widthM
        +heightM
        +depthM
    }
    class InstanciaDecorativa {
        +posicion
        +rotacionGrados
        +color
        +escala
        +mover() InstanciaDecorativa
        +rotar() InstanciaDecorativa
        +colorear() InstanciaDecorativa
    }
    FabricaActivos3D --> Activo3DCompartido : crea una vez por clave
    InstanciaDecorativa --> Activo3DCompartido : comparte
```

- **Bridge.** `elegirRenderizador` usa Quick Look en iOS (también iPadOS, que se anuncia como Mac táctil), Scene Viewer en Android (con WebXR de respaldo), WebXR en otros navegadores con `immersive-ar`, y la vista 3D sin AR en los demás. Mesa, arco y pista no cambian: sólo cambia el renderizador. Las tres piezas se apoyan en el piso (`ar-placement="floor"`); el arco es una estructura de pie de 2,4 m, no un elemento de pared.
- **Flyweight.** `FabricaActivos3D` congela el activo y lo reutiliza por `assetId@vN`. Si llegan datos distintos con la misma clave responde `ar.asset_conflict` en vez de sobrescribir, coherente con las versiones inmutables de DECOR-36. `InstanciaDecorativa` guarda posición, rotación y color sin copiar el activo, y su escala es siempre 1.
- **Escala 1:1.** Todos los renderizadores fijan `ar-scale="fixed"`. Esto impide redimensionar, pero no corrige un archivo mal escalado: la escala real depende de los GLB y USDZ publicados (mesa v2; arco y pista v3, recentrados).

Límites conocidos:

- La E2E (`e2e/ar-viewer.spec.ts`) corre en Chromium. Comprueba los atributos AR por plataforma y la carga real del GLB, pero no abre visores nativos. Detectar la superficie, colocar, mover y rotar se evidencia manualmente en Android y en iPhone.
- Cuando `<model-viewer>` ya está registrado, React 19 asigna `src`, `alt`, `poster`, `ar`, `loading` y `reveal` como propiedades y no quedan en el DOM. El componente los escribe con `setAttribute` para que DECOR-39 pueda verificarlos.
- `@google/model-viewer` y `three` se descargan sólo en la vista 3D.
- Quick Look y Scene Viewer colocan el **origen** del archivo sobre la superficie y no aplican el recentrado de la vista 3D. El arco v2 y la pista v2 tenían geometría descentrada (arco a ~4,3 m del origen y 15 cm bajo el piso; pista 28,5 cm bajo el origen), así que en AR no se apoyaban en el punto elegido. Corregido: se publicaron **arco v3 y pista v3** recentrados (centro X/Z = 0, base Y = 0, misma escala); `mesa` v2 ya estaba centrada. La vista los toma sin cambios de código.
- En iPhone, Quick Look sólo está disponible en Safari (y en Chrome, Edge o Firefox de iOS). Si el enlace se abre dentro de WhatsApp, Instagram o la app de Google, `<model-viewer>` no ofrece AR; la vista lo explica y oculta el botón y los pasos.
- Después del login la app vuelve a `/packages`; un enlace directo a la vista 3D no regresa a ella.

### 2.3 Diagrama de contenedores

```mermaid
flowchart TD
    Usuario(["Usuario<br/>Wedding planner / cliente"])
    Cliente(["Cliente Web móvil<br/>Next.js + &lt;model-viewer&gt;"])

    subgraph Backend["Backend (Next.js)"]
        Paquetes(["Módulo de Paquetes<br/>Builder + reglas"])
        Catalogo(["Módulo de Catálogo<br/>Metadatos y URLs 3D"])
        EventBus{{"Event Bus / Pub-Sub<br/>Supabase Realtime"}}
        Presupuesto(["Módulo de Presupuesto<br/>Consumidor de eventos"])

        Paquetes -->|"publica evento"| EventBus
        EventBus -->|"notifica"| Presupuesto
    end

    Activos[("Cloudinary<br/>Activos .glb / .usdz / poster")]
    Supabase[("Supabase<br/>PostgreSQL + PostgREST + Auth + Realtime")]
    Visor(["Visor AR nativo<br/>iOS: Quick Look<br/>Android: Scene Viewer"])

    Usuario -->|"Configura evento"| Cliente
    Cliente -->|"agregar/eliminar módulo"| Paquetes
    Cliente -->|"consultar catálogo"| Catalogo
    Presupuesto -->|"actualización en vivo"| Cliente
    Paquetes -->|"persiste estado"| Supabase
    Catalogo -->|"consulta metadatos"| Supabase
    Catalogo -->|"obtiene url del activo"| Activos
    Presupuesto -->|"actualiza presupuesto"| Supabase
    Cliente -->|"abre AR"| Visor
    Activos -->|"modelo 3D"| Visor
```

### 2.4 Consecuencias, Riesgos y mitigaciones

La arquitectura sugerida tiene varios elementos relevantes a tener en cuenta. Respecto al desacoplamiento, el presupuesto no está sujeto a llamadas directas desde Paquetes; por ende, se sugiere emplear contratos de eventos versionados y pruebas de integración.

En cuanto a la escalabilidad, los clientes tienen la capacidad de expandirse de manera autónoma, dividiendo procesos únicamente cuando haya una necesidad real de carga.

En lo que respecta a la consistencia eventual, puede haber un pequeño retraso entre la actualización del paquete y el presupuesto. Para disminuir este retraso, se puede mostrar un estado de "actualizando...", conservar la base de datos como fuente de verdad y posibilitar la resincronización.

La observabilidad también es un desafío, dado que los flujos asíncronos son más complicados de depurar. Por eso se aconseja el uso de eventId/correlationId, registros estructurados y métricas sobre fallos y reintentos.

Para prevenir que se repita o se pierda la entrega, es importante tener en cuenta que un canal de tiempo real no siempre actúa como una cola durable. Por ello, los consumidores tienen que ser idempotentes, almacenar los datos antes y disponer de procedimientos para volver a intentar y conciliar desde la base de datos.

Por último, respecto a la seguridad, si los canales en tiempo real se configuran de manera incorrecta pueden revelar información. Por eso es necesario establecer políticas de RLS por usuario o evento, canales privados y mecanismos de autenticación.

## 3. Patrón arquitectónico: Publish-Subscribe / Event Bus

### 3.1. Problema que resuelve

El Servicio/Módulo de Paquetes produce cambios del dominio, mientras que Presupuesto y futuros consumidores necesitan reaccionar. Si Paquetes invocara directamente a cada interesado, aumentaría el acoplamiento y cada nuevo consumidor obligaría a modificar código ya estable. Publish-Subscribe introduce un intermediario: el productor publica un evento y desconoce quién lo procesa.

### 3.2. Participantes y responsabilidades

- Productor - Paquetes: valida, persiste el cambio y publica un evento del dominio.
- Event Bus: enruta el evento a los suscriptores del tópico correspondiente.
- Consumidor - Presupuesto: procesa el evento, recalcula y persiste el nuevo total.
- Cliente AR: recibe el valor actualizado por canal realtime o lo consulta nuevamente desde la API.

### 3.3. Diagrama de secuencia

```mermaid
sequenceDiagram
    participant Usuario
    participant ClienteAR as Cliente AR
    participant Paquetes
    participant BD
    participant EventBus as Event Bus
    participant Presupuesto

    Usuario->>ClienteAR: 1. agrega un módulo
    ClienteAR->>Paquetes: 2. POST/paquetes/{id}/modulos
    Paquetes->>BD: 3. valida y persiste cambio
    BD->>Paquetes: 4. commit OK
    Paquetes->>EventBus: 5. publica móduloAgregado
    EventBus->>Presupuesto: 6. entrega evento
    Presupuesto->>BD: 7. recalcula y guarda presupuesto
    Presupuesto->>ClienteAR: 8. presupuesto agregado
    ClienteAR->>Usuario: 9. muestra el valor en vivo
```

### 3.4. Decisiones de fallo y recuperación

- Persistencia primero: el paquete debe quedar confirmado en la base de datos antes de emitir el evento. Así, la base de datos permanece como fuente de verdad incluso si falla el canal realtime.
- Reintento controlado: si la publicación o el consumo falla transitoriamente, se reintenta con un número limitado de intentos y registro del error.
- Idempotencia: cada evento lleva eventId. Presupuesto registra los eventId procesados o valida una versión del agregado para no sumar dos veces el mismo cambio.
- Resincronización: si el cliente pierde una actualización realtime, vuelve a consultar el presupuesto persistido. Para un entorno productivo con exigencias mayores, se recomienda un broker o cola durable.

### 3.5. ¿Qué pasaría sin Publisher-Suscribe?

Paquetes debería contactar directamente a Presupuesto tras cada operación para conocer cualquier nuevo cliente futuro. Si el consumidor falla, es posible que se detenga o degrade el flujo de selección; si se añaden notificaciones o analíticas, sería necesario cambiar los paquetes. El resultado sería un acoplamiento más alto, menos extensibilidad y pruebas más complejas.

Supabase Realtime puede funcionar como un sistema de baja latencia para el MVP, sin embargo, el diseño no debe suponer que un canal en tiempo real sustituye por sí mismo las garantías de una cola durable. Por esta razón, se sugiere la idempotencia, la persistencia anterior y la reconciliación.

## 4. Patrones de diseño GoF aplicados

DecorAR propone varios patrones de diseño para abordar diversas necesidades:

El patrón Builder, un patrón de creación, permite la construcción paso a paso de paquetes y la validación de reglas antes de generar el producto final; por consiguiente, es el patrón principal implementado.

El patrón Prototype, también de creación, permite duplicar configuraciones similares sin necesidad de reconstruirlas módulo a módulo. Para esta entrega se implementa en código y se evidencia mediante la clonación profunda de una configuración.

Por su parte, el patrón Composite, un patrón estructural, permite tratar de la misma manera tanto los elementos decorativos individuales como los conjuntos decorativos, lo que lo convierte en un patrón complementario.

El patrón Bridge, también estructural, desacopla el elemento decorativo de la plataforma de renderizado de realidad aumentada, mientras que el patrón Flyweight, igualmente estructural, permite reutilizar el mismo activo 3D en múltiples instancias dentro de la escena. Estos tres últimos patrones se consideran complementarios dentro de la arquitectura propuesta.

### 4.1. Builder: patrón principal implementado

El propósito del patrón Builder es distinguir entre la construcción incremental de PaqueteDecoracion y su representación final, lo que posibilita que cada adición sea validada. El problema que soluciona es el de evitar constructores con numerosos parámetros opcionales o setters desparramados, ya que estos podrían producir estados intermedios inválidos y redundar las normas de capacidad. Los participantes más importantes son PaqueteDecoracion, PaqueteDecoracionBuilderImpl, DirectorEvento y PaqueteDecoracionBuilder. Por lo tanto, se optimiza la legibilidad, se simplifica el encadenamiento de operaciones y se centralizan las validaciones; sin embargo, se agrega una capa de indirección que es necesaria a causa de las reglas y variaciones del objeto.

```mermaid
classDiagram
    class PaqueteDecoracionBuilderImpl {
        -PaqueteDecoracion paquete
        -ReglaEspacio reglas
        +agregarMesa()
        +agregarArco()
        +agregarPistaBaile()
        +construir() PaqueteDecoracion
        -validarYagregar(m)
    }

    class DirectorEvento {
        +construirPaqueteBasico(b: PaqueteDecoracionBuilder)
    }

    class PaqueteDecoracion {
        +Modulo[] modulos
        +TipoEspacio tipoEspacio
        +number capacidadM2
        +number espacioUsadoM2
        +agregarModulo(m: Modulo)
    }

    class PaqueteDecoracionBuilder {
        <<interface>>
        +agregarMesa()
        +agregarArco()
        +agregarPistaBaile()
        +construir() PaqueteDecoracion
    }

    PaqueteDecoracionBuilderImpl ..|> PaqueteDecoracionBuilder : implementa
    PaqueteDecoracionBuilderImpl ..> PaqueteDecoracion : crea
    DirectorEvento --> PaqueteDecoracionBuilder : usa
```

En las siguientes imágenes se muestra la funcionalidad del Builder gracias al diagrama de clases:

```javascript
class PaqueteDecoracionBuilderImpl extends PaqueteDecoracionBuilder {
  constructor(tipoEspacio, capacidadM2) {
    super();
    if (!REGLAS_ESPACIO[tipoEspacio]) {
      throw new Error(`Tipo de espacio no soportado: ${tipoEspacio}`);
    }
    this.paquete = new PaqueteDecoracion(tipoEspacio);
    this.reglas = { capacidadM2 };
  }

  _validarYAgregar(modulo) {
    const espacioFinal = this.paquete.espacioUsadoM2 + modulo.ocupaM2;
    if (espacioFinal > this.reglas.capacidadM2) {
      console.log(
        `ERROR: No se agregó "${modulo.nombre}": excede la capacidad del espacio ` +
        `(${espacioFinal}/${this.reglas.capacidadM2} m²).`
      );
      return this;
    }
    this.paquete.agregarModulo(modulo);
    return this;
  }

  agregarMesa() { return this._validarYAgregar(CATALOGO.mesaRedonda); }
  agregarArco() { return this._validarYAgregar(CATALOGO.arcoFloral); }
  agregarPistaBaile() { return this._validarYAgregar(CATALOGO.pistaBaile); }

  construir() {
    // Devuelve una copia para evitar que el cliente modifique el estado interno del builder.
    return {
      tipoEspacio: this.paquete.tipoEspacio,
      modulos: this.paquete.modulos.map((m) => ({ ...m })),
      espacioUsadoM2: this.paquete.espacioUsadoM2,
    };
  }
}
```

Y lo corremos en la terminal:

```text
DecorAR — prueba patrón Builder

PRUEBA 1: Paquete armado paso a paso para un salón social:
{
  tipoEspacio: 'salonSocial',
  modulos: [
    {
      id: 'mesa-redonda',
      nombre: 'Mesa redonda x10',
      precio: 250000,
      ocupaM2: 4
    },
    {
      id: 'mesa-redonda',
      nombre: 'Mesa redonda x10',
      precio: 250000,
      ocupaM2: 4
    },
    {
      id: 'arco-floral',
      nombre: 'Arco floral de entrada',
      precio: 200000,
      ocupaM2: 2
    },
    {
      id: 'pista-baile-4x4',
      nombre: 'Pista de baile 4x4',
      precio: 600000,
      ocupaM2: 16
    }
  ],
  presupuestoTotal: 1300000,
  espacioUsadoM2: 26
}
```

```text
PRUEBA 3: Validación de regla de espacio: se intenta agregar DOS pistas de baile a una casa (30 m²):
  ERROR: No se agregó "Pista de baile 4x4": excede la capacidad del espacio (32/30 m²).
{
  tipoEspacio: 'casa',
  modulos: [
    {
      id: 'pista-baile-4x4',
      nombre: 'Pista de baile 4x4',
      precio: 600000,
      ocupaM2: 16
    },
    {
      id: 'arco-floral',
      nombre: 'Arco floral de entrada',
      precio: 200000,
      ocupaM2: 2
    }
  ],
  presupuestoTotal: 800000,
  espacioUsadoM2: 18
}
```

```text
PRUEBA 2: Paquete básico armado por el Director (reutilizable) para aire libre:
{
  tipoEspacio: 'aireLibre',
  modulos: [
    {
      id: 'arco-floral',
      nombre: 'Arco floral de entrada',
      precio: 200000,
      ocupaM2: 2
    },
    {
      id: 'mesa-redonda',
      nombre: 'Mesa redonda x10',
      precio: 250000,
      ocupaM2: 4
    },
    {
      id: 'mesa-redonda',
      nombre: 'Mesa redonda x10',
      precio: 250000,
      ocupaM2: 4
    }
  ],
  presupuestoTotal: 700000,
  espacioUsadoM2: 10
}
```

### 4.2. Prototype: segundo patrón modelado

**Propósito:** Conservar una base que puede ser alterada después y crear una ConfiguracionEvento a partir de otra configuración válida.

**Problema de código:** Los wedding planners tienen la posibilidad de repetir paquetes, estilos o salones; rehacer cada acontecimiento desde el principio incrementa los errores y malgasta trabajo.

**Participantes:** ConfiguracionClonable, ConfiguracionEvento y ServicioDeEventos.

**Resultados:** Disminuye el costo de generar variantes; exige tomar decisiones sobre qué datos se copian en profundidad. Los activos 3D que no cambian pueden ser compartidos, pero las preferencias y las listas mutables deben ser duplicadas para prevenir efectos cruzados.

```mermaid
classDiagram
    class ConfiguracionClonable {
        <<interface>>
        +clonar() ConfiguracionEvento
    }

    class ConfiguracionEvento {
        +TipoEspacio tipoEspacio
        +Modulo[] modulos
        +object preferencias
        +clonar() ConfiguracionEvento
    }

    class ServicioDeEventos {
        +duplicarEvento(origen)
    }

    ConfiguracionEvento ..|> ConfiguracionClonable : implementa
    ServicioDeEventos --> ConfiguracionClonable : solicita clonar()
```

### 4.3. Composite: paquetes y módulos jerárquicos

**Intención:** Componer objetos en estructuras de árbol y tratar de forma uniforme elementos simples y grupos.

**Problema de código:** Una “Zona de bienvenida” puede contener un arco floral y una mesa redonda. Sin Composite, el cálculo de precio, área y listado tendría condicionales distintos para cada nivel.

**Participantes:** ComponenteDecorativo (interfaz), ElementoDecorativo (hoja) y GrupoDecorativo/ModuloCompuesto (composite).

**Consecuencias:** Simplifica recorridos y cálculos recursivos; facilita crear paquetes anidados. La implementación rechaza ciclos y limita los grupos a tres niveles.

### 4.4. Bridge: desacoplar decoración y render AR

**Intención:** Separar la abstracción del elemento decorativo de la implementación de renderizado para que ambas jerarquías evolucionen de manera independiente.

**Problema de código:** Los mismos objetos deben mostrarse en iOS y Android, pero los mecanismos nativos y formatos preferidos no son idénticos.

**Participantes:** ElementoAR (abstracción), MesaAR/ArcoAR (abstracciones refinadas), RenderizadorAR (implementador), RenderizadorQuickLook y RenderizadorSceneViewer (implementaciones concretas).

**Consecuencias:** Evita duplicar clases por combinación “tipo de elemento x plataforma”; permite añadir WebXR u otro visor sin modificar el modelo de decoración. Añade una interfaz adicional que debe mantenerse simple.

### 4.5. Flyweight: reutilización de activos 3D

**Intención:** Compartir estado intrínseco costoso entre muchas instancias y mantener el estado extrínseco fuera del objeto compartido.

**Problema de código:** Varias instancias de una misma mesa no deben implicar varias copias del mismo archivo 3D en memoria ni descargas idénticas.

**Participantes:** Activo3DCompartido (flyweight), FabricaActivos3D (cache por assetId/URL) e InstanciaDecorativa (posición, rotación, escala, color permitido).

**Consecuencias:** Reduce memoria, descargas y tiempo de carga; exige que el activo compartido sea inmutable y que transformaciones por instancia permanezcan separadas.

## 5. Conclusiones

La arquitectura Publish-Subscribe y la orientada a eventos posibilitan que el presupuesto se actualice sin que los componentes tengan un acoplamiento directo, con el canal en tiempo real como medio de difusión y la base de datos como fuente principal de información. En términos de código, Builder simplifica la creación de paquetes, Prototype permite que las configuraciones se reutilicen, Composite gestiona conjuntos decorativos, Bridge distingue las variaciones entre plataformas AR y Flyweight mejora la utilización de activos 3D que se repiten.

Como restricciones del MVP, no se tiene previsto desarrollar microservicios independientes en el semestre. Asimismo, el sistema en tiempo real otorga prioridad a la latencia baja, aunque la precisión de AR también depende del aparato y de los activos 3D. Al final, Prototype y Flyweight tendrán que ser sometidos a pruebas de validación para prevenir inconvenientes con estados compartidos.
