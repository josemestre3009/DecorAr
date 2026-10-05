# Tasks

## 1. Contrato

- [x] 1.1 Definir el sobre común y los eventos package.module.added, package.module.removed y budget.recalculated en el dominio de events; verificar con typecheck
- [x] 1.2 Implementar parseDomainEvent con rechazo de campos faltantes, tipos desconocidos y versiones distintas de 1; verificar con pruebas unitarias
- [x] 1.3 Añadir un ejemplo válido de cada evento y la función del canal package:{packageId}; verificar con pruebas unitarias
- [x] 1.4 Añadir el puerto EventPublisher en la aplicación de events; verificar que la prueba de arquitectura pasa

## 2. Integración

- [x] 2.1 Actualizar la documentación del módulo de eventos
- [x] 2.2 Ejecutar npm run lint, npm run typecheck y las pruebas afectadas; corregir divergencias antes de revisión
- [x] 2.3 Ejecutar openspec validate decor-29-event-contracts --type change --strict
