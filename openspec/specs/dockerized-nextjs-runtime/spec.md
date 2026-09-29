# dockerized-nextjs-runtime Specification

## Purpose
Define la ejecución reproducible y segura de DecorAR como un único contenedor de aplicación conectado a servicios externos alojados.

## Requirements

### Requirement: Único servicio de aplicación
El entorno Docker de DecorAR SHALL definir y ejecutar únicamente el monolito Next.js como servicio `app`. El entorno MUST NOT incluir servicios locales equivalentes a Supabase, PostgreSQL, PostgREST, Auth, Realtime o Cloudinary.

#### Scenario: Inventario de servicios
- **WHEN** un integrante consulta los servicios definidos por Compose
- **THEN** el resultado contiene únicamente `app`

#### Scenario: Configuración de dependencias alojadas
- **WHEN** la aplicación se ejecuta mediante Compose con un `.env` válido
- **THEN** recibe por configuración externa las URLs y credenciales de Supabase y Cloudinary alojados sin desplegar esos proveedores

### Requirement: Imagen de producción mínima
La imagen de producción SHALL contener la salida standalone y los activos públicos necesarios para ejecutar DecorAR. El proceso MUST ejecutarse con un usuario no root y MUST escuchar en el puerto 3000 sobre todas las interfaces del contenedor.

#### Scenario: Ejecución no privilegiada
- **WHEN** se inspecciona el usuario efectivo del contenedor iniciado
- **THEN** el proceso no se ejecuta como `root` ni con UID 0

#### Scenario: Aplicación disponible
- **WHEN** el contenedor saludable expone el puerto 3000
- **THEN** la interfaz de DecorAR responde mediante HTTP

### Requirement: Configuración sensible fuera de la imagen
El build Docker MUST excluir archivos de entorno y MUST NOT incorporar valores de service role de Supabase ni secretos de Cloudinary en la imagen final. La configuración de runtime SHALL suministrarse externamente mediante el archivo indicado por Compose.

#### Scenario: Inspección de la imagen
- **WHEN** se inspeccionan el sistema de archivos y la configuración de la imagen final
- **THEN** no aparecen archivos `.env`, valores de service role ni secretos de Cloudinary

### Requirement: Salud no sensible
La aplicación SHALL exponer `GET /api/health` para comprobar que el proceso está disponible. La respuesta MUST NOT incluir variables de entorno, credenciales, URLs privadas ni resultados detallados de proveedores externos.

#### Scenario: Proceso saludable
- **WHEN** un cliente solicita `GET /api/health` a una instancia operativa
- **THEN** recibe HTTP 200 y un estado estable que indica disponibilidad

#### Scenario: Respuesta segura
- **WHEN** se inspecciona el cuerpo de la respuesta de salud
- **THEN** no contiene secretos ni configuración de Supabase o Cloudinary

### Requirement: Operación reproducible
La documentación técnica SHALL indicar los comandos para construir, iniciar, observar logs, detener y reconstruir DecorAR mediante Docker Compose.

#### Scenario: Inicio por un integrante
- **WHEN** un integrante instala Docker, configura `.env` y sigue la documentación
- **THEN** puede iniciar DecorAR con `docker compose up --build` sin instalar servicios auxiliares locales
