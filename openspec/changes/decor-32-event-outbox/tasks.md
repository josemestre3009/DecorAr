# Tasks

## 1. Persistencia

- [x] 1.1 Crear la migración con `private.domain_events`, `public.packages`, `public.package_items`, grants y RLS; verificar con la prueba de contrato SQL
- [x] 1.2 Crear `commit_package_change` atómica con propiedad, versión esperada e inserción del evento; verificar rollback en PostgreSQL embebido
- [x] 1.3 Crear `claim_initial_domain_events`, `mark_domain_event_published` y `record_domain_event_failure`; verificar reclamo único y permisos en PostgreSQL embebido

## 2. Aplicación e infraestructura

- [x] 2.1 Añadir los puertos `PackageChangeOutbox` y `OutboxStore` y el caso de uso `DrainOutboxUseCase`; verificar con pruebas unitarias
- [x] 2.2 Implementar `SupabaseEventOutbox` y `SupabaseBroadcastEventPublisher`; verificar con pruebas unitarias
- [x] 2.3 Exponer `createEventOutboxDependencies` en la composición; verificar con prueba de composición
- [x] 2.4 Verificar que eventos y paquetes no importan Supabase ni presupuesto

## 3. Integración

- [x] 3.1 Actualizar la documentación del módulo de eventos y de paquetes
- [x] 3.2 Ejecutar npm run lint, npm run typecheck y las pruebas afectadas
- [ ] 3.3 Ejecutar openspec validate decor-32-event-outbox --type change --strict (CLI no instalado en el entorno de implementación)
