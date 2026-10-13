# Spec Delta

## ADDED Requirements

### Requirement: Mutaciones de zonas aisladas del navegador
El navegador MUST realizar las mutaciones de zonas y módulos mediante Route Handlers autenticados. Solo código server-side SHALL invocar las operaciones persistentes privilegiadas; `anon` y `authenticated` MUST carecer de permisos directos de escritura y ejecución sobre ellas.

#### Scenario: Editor crea o modifica una zona
- **WHEN** el usuario crea, renombra, mueve o elimina una zona desde el configurador
- **THEN** el navegador llama al Route Handler correspondiente y no escribe `package_groups` ni `package_items` directamente

#### Scenario: Escritura directa autenticada
- **WHEN** un cliente autenticado intenta escribir tablas de negocio o ejecutar una RPC de mutación de zonas directamente
- **THEN** PostgreSQL rechaza la operación por RLS o privilegios

#### Scenario: Ejecución server-side autorizada
- **WHEN** un Route Handler valida sesión y propiedad e invoca una mutación con el cliente administrativo
- **THEN** la RPC `SECURITY INVOKER` con `search_path = ''` ejecuta usando nombres calificados y valida nuevamente la propiedad
