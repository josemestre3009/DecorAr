# Spec Delta

## ADDED Requirements

### Requirement: Escrituras de eventos y plantillas mediadas por servidor
El navegador MUST usar endpoints de la aplicación para crear o modificar eventos y plantillas. Solo código server-side SHALL ejecutar las operaciones privilegiadas sobre tablas de negocio, y cada operación SHALL validar sesión y propiedad antes de usar privilegios administrativos.

#### Scenario: Crear evento desde el navegador
- **WHEN** el navegador crea un evento
- **THEN** envía una solicitud al Route Handler y no ejecuta una escritura directa contra la API de tablas de Supabase

#### Scenario: Copiar configuración
- **WHEN** el navegador guarda una plantilla o crea un evento desde una plantilla
- **THEN** invoca un Route Handler autenticado que valida propiedad antes de ejecutar la copia server-side

#### Scenario: Intento directo sobre tabla de negocio
- **WHEN** un cliente público o autenticado intenta insertar, actualizar o eliminar directamente eventos, plantillas o sus dependencias
- **THEN** la base de datos rechaza la escritura
