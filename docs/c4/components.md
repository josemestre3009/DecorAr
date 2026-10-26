# C4 nivel 3: componentes principales

Vista simplificada del diseño interno de DecorAR. Muestra responsabilidades y dependencias importantes; omite clases auxiliares y detalles operativos.

> [Abrir el diagrama interactivo detallado](../../public/docs/components.html) — permite enfocar componentes, seguir rutas, cambiar tema y abrir la evidencia exacta del código. En producción: `/docs/components.html`.

El diagrama interactivo amplía esta vista con cuatro recorridos guiados: configuración de un evento, seguridad por capas, presupuesto en vivo y experiencia AR. El Mermaid siguiente permanece como respaldo ligero para lectores Markdown.

```mermaid
%%{init: {
  "flowchart": {
    "useMaxWidth": false,
    "diagramPadding": 60,
    "nodeSpacing": 80,
    "rankSpacing": 90,
    "curve": "basis"
  },
  "themeVariables": {
    "fontSize": "17px"
  }
}}%%
flowchart TB
    user(["Persona usuaria"])

    subgraph app["APLICACIÓN DECORAR — Next.js"]
        direction TB
        ui["Interfaz web<br/><b>src/app</b>"]
        controllers["API y controladores<br/><b>src/app/api · src/interfaces</b>"]

        subgraph application["APLICACIÓN Y SEGURIDAD"]
            direction LR
            session["SessionGateway<br/>Identifica al usuario<br/><b>session-gateway.ts</b>"]
            access["Control de acceso<br/>Comprueba propietario<br/><b>authorize-package-access.use-case.ts</b>"]
            composition["Composition Root<br/>Construye casos de uso<br/><b>src/composition/server.ts</b>"]
        end

        subgraph business["NEGOCIO — src/modules"]
            direction LR
            packages["Packages<br/>Paquetes, zonas y plantillas"]
            catalog["Catalog<br/>Módulos decorativos"]
            budget["Budget<br/>Calcula el total"]
            events["Events<br/>Outbox y publicación"]
            ar["AR<br/>Prepara el visor"]
        end

        subgraph adapters["GATEWAYS Y ADAPTADORES"]
            direction LR
            authGateway["Gateway de sesión<br/>Cliente Supabase con cookies"]
            dataGateway["Repositorios Supabase<br/>Paquetes, catálogo y presupuesto"]
            eventGateway["Event Outbox + Publisher<br/>Persistencia y Broadcast"]
            assetGateway["Cloudinary Asset Storage<br/>Activos 3D"]
        end
    end

    subgraph external["SISTEMAS EXTERNOS"]
        direction LR
        supabaseAuth["Supabase Auth"]
        supabaseDb[("Supabase PostgreSQL<br/>PostgREST, RPC y RLS")]
        realtime["Supabase Realtime<br/>Canal privado package:{id}"]
        cloudinary[("Cloudinary<br/>GLB, USDZ y posters")]
        viewer["Visor AR<br/>Quick Look, Scene Viewer o WebXR"]
    end

    user -->|"1. Navega y configura"| ui
    ui -->|"2. Solicitud HTTP"| controllers
    controllers -->|"3. Usuario actual"| session
    session -->|"Lee sesión"| authGateway
    authGateway -->|"getUser"| supabaseAuth
    controllers -->|"4. Autorizar recurso"| access
    session -->|"Usuario autenticado"| access
    access -->|"Consulta propietario"| dataGateway
    access -->|"5. Acceso permitido"| composition

    composition -->|"Ejecuta caso de uso"| packages
    composition -->|"Lista módulos"| catalog
    composition -->|"Consulta total"| budget
    composition -->|"Prepara experiencia"| ar

    packages -->|"Guarda por RPC"| dataGateway
    catalog -->|"Lee catálogo activo"| dataGateway
    budget -->|"Lee/guarda total"| dataGateway
    dataGateway -->|"PostgREST / RPC"| supabaseDb

    packages -->|"Cambio confirmado"| budget
    packages -->|"Evento de dominio"| events
    events -->|"Persiste/reclama outbox"| eventGateway
    budget -->|"budget.recalculated"| eventGateway
    eventGateway -->|"RPC de outbox"| supabaseDb
    eventGateway -->|"Broadcast privado"| realtime
    realtime -.->|"6. Notifica cambio"| ui

    catalog -->|"Publica activo"| assetGateway
    assetGateway -->|"Carga archivos"| cloudinary
    catalog -->|"URLs del activo"| ar
    ar -->|"7. Abre experiencia"| viewer

    classDef person fill:#7c3aed,color:#ffffff,stroke:#5b21b6,stroke-width:2px;
    classDef presentationStyle fill:#dbeafe,color:#172554,stroke:#2563eb,stroke-width:2px;
    classDef applicationStyle fill:#ede9fe,color:#2e1065,stroke:#7c3aed,stroke-width:2px;
    classDef businessStyle fill:#dcfce7,color:#052e16,stroke:#16a34a,stroke-width:2px;
    classDef infrastructureStyle fill:#ffedd5,color:#431407,stroke:#ea580c,stroke-width:2px;
    classDef externalStyle fill:#f1f5f9,color:#0f172a,stroke:#64748b,stroke-width:2px;

    class user person;
    class ui,controllers presentationStyle;
    class session,access,composition applicationStyle;
    class packages,catalog,budget,events,ar businessStyle;
    class authGateway,dataGateway,eventGateway,assetGateway infrastructureStyle;
    class supabaseAuth,supabaseDb,realtime,cloudinary,viewer externalStyle;
```

### Colores

- **Azul:** presentación y entradas.
- **Morado:** aplicación, composición y seguridad.
- **Verde:** lógica de negocio.
- **Naranja:** gateways y adaptadores.
- **Gris:** sistemas externos.

## Flujo principal para explicarlo

1. La persona usa la **interfaz web**, que envía una solicitud al controlador.
2. **SessionGateway** valida la sesión mediante Supabase Auth.
3. El **control de acceso** compara el usuario con el propietario del recurso.
4. El **Composition Root** proporciona el caso de uso y sus adaptadores.
5. El módulo aplica sus reglas; el gateway correspondiente traduce la operación hacia Supabase o Cloudinary.
6. Los cambios de Packages recalculan Budget y generan eventos durables.
7. Realtime notifica a la interfaz; AR abre el visor compatible cuando la persona lo solicita.

Flujo resumido:

```text
Usuario → Interfaz → Controlador → SessionGateway → Autorización
        → Caso de uso → Gateway específico → Sistema externo
```

### Relaciones internas importantes

```text
Packages → Budget: un cambio confirmado provoca el recálculo del total.
Packages → Events: el cambio deja un evento durable en el outbox.
Events → Realtime: el publicador envía el evento al canal privado del paquete.
Realtime → Interfaz: la pantalla recibe la notificación y actualiza el presupuesto.
Catalog → AR: entrega las URLs y datos del activo que debe visualizarse.
```

## Responsabilidades

| Componente | Responsabilidad principal |
|---|---|
| Interfaz web | Presenta catálogo, configuración, presupuesto y experiencia AR. |
| Entradas | Reciben solicitudes y delegan en los casos de uso. |
| Autenticación y autorización | `SessionGateway` valida la identidad; el control de acceso verifica la propiedad del paquete o plantilla. |
| Composition Root | Construye los casos de uso con sus gateways y adaptadores. |
| Paquetes y plantillas | Gestiona eventos, módulos decorativos, zonas, clonación y plantillas. |
| Catálogo | Gestiona los módulos disponibles y sus activos 3D. |
| Presupuesto | Calcula y conserva el costo del paquete. |
| Eventos | Guarda eventos en outbox y publica notificaciones privadas. |
| Realidad aumentada | Selecciona los activos y el visor compatible con el dispositivo. |
| Gateways y adaptadores | Aíslan los módulos de Supabase, Cloudinary y Realtime. |

## Decisiones clave

- Los módulos comparten una sola aplicación Next.js; no son microservicios.
- `SessionGateway` autentica. El control de acceso autoriza cada recurso.
- Los casos de uso dependen de gateways, no directamente de Supabase o Cloudinary.
- Supabase RLS añade una segunda barrera de seguridad.
- Los cambios de paquetes actualizan Presupuesto internamente; Realtime solo notifica a la interfaz.
- Los eventos reales son `package.module.added`, `package.module.removed`, `package.module.moved` y `budget.recalculated`.

## Ubicación en el código

| Área | Ruta |
|---|---|
| Interfaz y API | `src/app` |
| Controladores | `src/interfaces` |
| Composition Root | `src/composition/server.ts` |
| SessionGateway | `src/infrastructure/supabase/session-gateway.ts` |
| Módulos | `src/modules` |
| Adaptadores Supabase | `src/infrastructure/supabase` y `src/modules/*/infrastructure` |
