# Spec Delta

## ADDED Requirements

### Requirement: Escenarios E2E autenticados
La base de pruebas de navegador SHALL permitir ejecutar escenarios que requieren una sesión autenticada sin depender de la entrega del correo de confirmación.

#### Scenario: Escenario autenticado reutilizable
- **WHEN** se ejecuta la suite E2E con las credenciales de prueba configuradas
- **THEN** los escenarios autenticados reutilizan una sesión establecida y no esperan un correo de confirmación
