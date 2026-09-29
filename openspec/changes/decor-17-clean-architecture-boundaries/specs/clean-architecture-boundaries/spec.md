# Spec Delta

## Purpose

Protege la independencia del dominio y establece límites verificables para que los módulos de negocio evolucionen sin acoplarse a frameworks, proveedores o consumidores concretos.

## ADDED Requirements

### Requirement: Módulos de negocio explícitos
El sistema SHALL organizar las capacidades de catálogo, paquetes, presupuesto, eventos y AR como módulos lógicos dentro de un único despliegue.

#### Scenario: Inspección de la estructura
- **WHEN** una persona inspecciona el código fuente
- **THEN** puede identificar cada módulo y sus capas de dominio, aplicación e infraestructura cuando correspondan

### Requirement: Dependencias dirigidas hacia el dominio
El dominio MUST permanecer independiente de interfaces, infraestructura, frameworks y proveedores, y la aplicación MUST depender de puertos en lugar de adaptadores concretos.

#### Scenario: Import de framework desde dominio
- **WHEN** código de dominio importa React, Next.js, Supabase, Cloudinary o infraestructura
- **THEN** la validación automática de arquitectura falla

#### Scenario: Import de infraestructura desde aplicación
- **WHEN** código de aplicación importa un adaptador de infraestructura
- **THEN** la validación automática de arquitectura falla

### Requirement: Módulos desacoplados por contrato
El módulo de paquetes MUST NOT depender directamente del módulo de presupuesto; la colaboración futura SHALL ocurrir mediante contratos de eventos o puertos.

#### Scenario: Dependencia de paquetes hacia presupuesto
- **WHEN** código del módulo de paquetes importa código del módulo de presupuesto
- **THEN** la validación automática de arquitectura falla

### Requirement: Cableado aislado en servidor
La selección y construcción de adaptadores concretos SHALL ocurrir en un composition root disponible únicamente para código de servidor.

#### Scenario: Construcción de dependencias
- **WHEN** una interfaz server-side necesita ejecutar una operación de aplicación
- **THEN** obtiene sus dependencias desde el composition root sin importar adaptadores desde dominio o aplicación

### Requirement: Límites comprobables
El proyecto SHALL proporcionar una prueba automática que detecte imports prohibidos y demuestre su rechazo mediante casos negativos controlados.

#### Scenario: Introducción de import prohibido
- **WHEN** la prueba analiza un fixture que viola una regla de dependencia
- **THEN** informa la regla y el archivo infractor

#### Scenario: Código conforme
- **WHEN** la prueba analiza el árbol de código de producción sin violaciones
- **THEN** termina correctamente
