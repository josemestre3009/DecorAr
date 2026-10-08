# Spec Delta

## Purpose

Garantiza que sólo el dueño de un paquete pueda leerlo, operarlo y escuchar su canal en tiempo real, con la autorización en los Route Handlers y RLS como defensa adicional en PostgreSQL.

## ADDED Requirements

### Requirement: Autorización por propiedad en Route Handlers
Todo Route Handler que opere sobre un paquete SHALL validar la sesión con `getUser()` y la propiedad del paquete antes de ejecutar el caso de uso. La comparación de propiedad MUST ocurrir en el código de la aplicación y MUST NOT depender de que RLS esté habilitada.

#### Scenario: Dueño
- **WHEN** el usuario A opera sobre su propio paquete
- **THEN** el caso de uso se ejecuta

#### Scenario: Paquete ajeno
- **WHEN** el usuario B opera sobre el paquete de A
- **THEN** responde 404 `package.not_found` en JSON, sin revelar que el paquete existe, y el caso de uso no se ejecuta

#### Scenario: Paquete ajeno con RLS deshabilitada
- **WHEN** la lectura del dueño devuelve el paquete de A a cualquiera, como ocurriría sin RLS, y B lo solicita
- **THEN** la respuesta sigue siendo 404 y el caso de uso no se ejecuta

#### Scenario: Anónimo
- **WHEN** una petición sin sesión válida llega a un Route Handler de paquete
- **THEN** responde 401 en JSON sin consultar el paquete

### Requirement: RLS como defensa adicional
Las tablas públicas de paquetes MUST tener RLS habilitada. `authenticated` SHALL poder leer únicamente sus propios paquetes y elementos, y `anon` MUST NOT tener permisos. Ningún cliente SHALL escribir paquetes directamente: las escrituras pasan por la RPC ejecutada por `service_role`.

#### Scenario: Lectura propia
- **WHEN** A lee `packages` o `package_items` con su sesión
- **THEN** sólo obtiene sus filas

#### Scenario: Lectura ajena
- **WHEN** B lee el paquete de A con su sesión
- **THEN** no obtiene filas

#### Scenario: Escritura directa
- **WHEN** `anon` o `authenticated` intenta insertar, actualizar o borrar paquetes o elementos, o ejecutar las RPC de outbox o de activación del catálogo
- **THEN** PostgreSQL deniega el permiso

### Requirement: Tablas internas privadas
La outbox y las tablas de eventos procesados MUST vivir en el schema `private`, sin uso del schema ni permisos para `anon` y `authenticated`, y MUST NOT publicarse en `supabase_realtime`.

#### Scenario: Acceso desde el cliente
- **WHEN** `anon` o `authenticated` consulta una tabla de `private`
- **THEN** PostgreSQL deniega el permiso

### Requirement: Canal Broadcast privado por paquete
El navegador SHALL usar Supabase sólo para Auth y para suscribirse al canal privado `package:{packageId}`. Realtime MUST autorizar la suscripción únicamente al dueño del paquete y MUST NOT aceptar mensajes publicados por clientes. El navegador MUST NOT usar `postgres_changes`.

#### Scenario: Suscripción del dueño
- **WHEN** A se suscribe a `package:{su paquete}` con su sesión
- **THEN** la suscripción se acepta y recibe los mensajes Broadcast del backend

#### Scenario: Suscripción ajena o anónima
- **WHEN** B o un anónimo se suscribe a `package:{paquete de A}`
- **THEN** Realtime rechaza la suscripción

#### Scenario: Presupuesto falso
- **WHEN** un cliente, incluido el dueño, intenta publicar `budget.recalculated` en el canal
- **THEN** Realtime lo rechaza porque no existe política de escritura

### Requirement: Service role sólo en servidor
La service role MUST usarse únicamente desde módulos `server-only`, MUST NOT llevar el prefijo `NEXT_PUBLIC_` y MUST NOT ser alcanzable desde el grafo de imports de ningún Client Component ni de la fábrica del navegador.

#### Scenario: Grafo del cliente
- **WHEN** se recorren los imports de cada módulo `"use client"` y de la fábrica del navegador
- **THEN** ninguno alcanza el cliente admin ni lee la variable de la service role

#### Scenario: Bundle compilado
- **WHEN** se compila con un valor centinela para la service role
- **THEN** ningún artefacto estático del navegador lo contiene
