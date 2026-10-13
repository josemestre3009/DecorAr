# C4 nivel 3: componentes de la aplicacion Next.js

```mermaid
flowchart TB
    browser["Navegador<br/>Server y Client Components"]

    subgraph app["Contenedor app: Next.js"]
        routes["src/app<br/>Paginas, Server Actions y Route Handlers"]
        interfaces["src/interfaces<br/>Controladores y adaptadores de entrada"]
        composition["src/composition<br/>Composition root server-only"]
        packages["Modulo packages<br/>Casos de uso + Builder, Prototype y Composite"]
        catalog["Modulo catalog<br/>Consulta y publicacion del catalogo"]
        budget["Modulo budget<br/>Calculo y consumidor idempotente"]
        events["Modulo events<br/>Outbox, drenaje, reintento y Broadcast"]
        ar["Modulo ar<br/>Bridge y Flyweight"]
        adapters["Adaptadores de infraestructura<br/>Repositorios Supabase, Cloudinary y logging"]
    end

    supabase[("Supabase alojado")]
    cloudinary[("Cloudinary alojado")]
    viewer["Visor AR"]

    browser --> routes
    routes --> interfaces
    routes --> composition
    interfaces --> packages
    interfaces --> catalog
    interfaces --> budget
    interfaces --> events
    composition --> adapters
    composition --> packages
    composition --> catalog
    composition --> budget
    composition --> events
    packages -->|"Eventos de dominio"| events
    events -->|"package.changed"| budget
    routes --> ar
    adapters --> supabase
    adapters --> cloudinary
    browser -.->|"Realtime privado y resincronizacion"| supabase
    ar --> viewer
```

Las flechas representan dependencias o interacciones reales. Los modulos no son microservicios: comparten proceso y despliegue, pero mantienen dominio, aplicacion e infraestructura separados.
