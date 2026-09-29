# application-foundation Specification

## Purpose
Proporciona una aplicación web reproducible y verificable sobre la cual pueden construirse las capacidades funcionales de DecorAR.

## Requirements

### Requirement: Aplicación ejecutable
El proyecto SHALL ofrecer una aplicación web que pueda ejecutarse en desarrollo y compilarse para producción con TypeScript estricto.

#### Scenario: Inicio en desarrollo
- **WHEN** una persona instala las dependencias y ejecuta el comando de desarrollo
- **THEN** la aplicación inicia y sirve la portada de DecorAR

#### Scenario: Compilación de producción
- **WHEN** una persona ejecuta el comando de compilación con una configuración válida
- **THEN** la aplicación produce los artefactos de producción sin errores

### Requirement: Portada identificable
La aplicación SHALL presentar una portada accesible que muestre el nombre DecorAR y explique brevemente su propósito.

#### Scenario: Visita desde dispositivo móvil
- **WHEN** una persona abre la ruta principal usando un viewport móvil
- **THEN** puede identificar DecorAR y leer su propósito sin desplazamiento horizontal

### Requirement: Comandos de calidad reproducibles
El proyecto SHALL proporcionar comandos para lint, comprobación de tipos, pruebas automatizadas y compilación de producción.

#### Scenario: Validación desde un clon limpio
- **WHEN** una persona instala exactamente las dependencias bloqueadas y ejecuta cada comando de calidad
- **THEN** lint, typecheck, pruebas y build terminan correctamente

### Requirement: Base de pruebas de navegador
El proyecto SHALL incluir una configuración de pruebas E2E capaz de iniciar la aplicación y ejecutar un escenario con emulación móvil.

#### Scenario: Smoke test móvil
- **WHEN** se ejecuta la suite E2E con el navegador requerido instalado
- **THEN** la suite abre la portada con emulación móvil y confirma la identidad de DecorAR
