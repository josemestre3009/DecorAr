# Spec Delta

## ADDED Requirements

### Requirement: Navegador sin CRUD de negocio
Los módulos ejecutados en el navegador MUST limitar Supabase a autenticación y suscripciones privadas de Realtime, y MUST NOT ejecutar CRUD directo sobre datos de catálogo, paquetes, elementos, presupuestos o eventos.

#### Scenario: Acceso directo desde módulo cliente
- **WHEN** un módulo cliente intenta usar la Data API para leer o modificar datos de negocio
- **THEN** la validación automática de arquitectura falla

### Requirement: Acceso de negocio mediante adaptadores server-side
El acceso Supabase a datos de negocio SHALL residir en adaptadores de infraestructura server-side invocados a través de puertos de aplicación.

#### Scenario: Persistencia desde una interfaz
- **WHEN** una interfaz solicita una operación de negocio persistente
- **THEN** delega en aplicación y el adaptador server-side implementa el puerto sin exponer credenciales elevadas
