# supabase-client-boundaries Specification

## Purpose
Impide que credenciales privilegiadas alcancen el navegador y define clientes Supabase adecuados para cada contexto de ejecución.

## Requirements

### Requirement: Configuración pública limitada
El navegador MUST recibir únicamente la URL del proyecto Supabase y una clave pública destinada a clientes no privilegiados.

#### Scenario: Creación del cliente de navegador
- **WHEN** la aplicación crea un cliente Supabase en el navegador con configuración válida
- **THEN** utiliza sólo variables públicas de URL y clave publicable

### Requirement: Cliente de sesión server-side
El servidor SHALL crear un cliente de sesión usando la clave pública y las cookies de la solicitud, manteniendo la autorización sujeta a la sesión y RLS.

#### Scenario: Lectura de sesión en servidor
- **WHEN** una operación server-side solicita un cliente Supabase
- **THEN** el cliente obtiene cookies mediante el almacén de cookies del framework y no utiliza la clave service role

### Requirement: Cliente administrativo aislado
Las operaciones administrativas SHALL usar un cliente separado, disponible únicamente para código de servidor y configurado sin persistencia de sesión.

#### Scenario: Creación del cliente administrativo
- **WHEN** código server-side crea el cliente administrativo con configuración válida
- **THEN** utiliza la service role sin exponerla a módulos cliente

### Requirement: Secretos ausentes del bundle cliente
La compilación MUST NOT incluir el valor de la service role ni credenciales Cloudinary en artefactos JavaScript servidos al navegador.

#### Scenario: Escaneo posterior al build
- **WHEN** la aplicación se compila con valores centinela para secretos server-side
- **THEN** ningún artefacto estático del navegador contiene dichos valores

### Requirement: Error explícito ante configuración faltante
Cada fábrica de cliente SHALL rechazar su creación con un error identificable cuando falte una variable requerida para ese contexto.

#### Scenario: Variable pública ausente
- **WHEN** se solicita un cliente público sin URL o clave pública
- **THEN** la creación falla con un mensaje que identifica la variable ausente

#### Scenario: Service role ausente
- **WHEN** se solicita un cliente administrativo sin service role
- **THEN** la creación falla con un mensaje que identifica la variable ausente
