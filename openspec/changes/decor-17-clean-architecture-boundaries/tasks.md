# Tasks

## 1. Estructura y contratos

- [x] 1.1 Crear módulos verticales para catalog, packages, budget, events y ar con documentación local; verificar que el árbol identifica cada capacidad sin carpetas vacías
- [x] 1.2 Implementar DomainError, Result, Clock, IdGenerator y Logger en el shared kernel; verificar sus contratos con pruebas unitarias y typecheck
- [x] 1.3 Documentar la dirección permitida de dependencias y el límite de monolito modular; verificar que el diagrama cubre interfaces, aplicación, dominio, puertos, infraestructura y composition root

## 2. Infraestructura y composición

- [x] 2.1 Mover las fábricas Supabase a infraestructura compartida conservando browser, sesión server-side y admin; verificar sus pruebas existentes, lint y typecheck
- [x] 2.2 Añadir un composition root server-only sin lógica de negocio anticipada; verificar que ningún módulo de dominio o aplicación importa adaptadores concretos

## 3. Límites automatizados

- [x] 3.1 Implementar una prueba de arquitectura sin dependencias nuevas para imports y CRUD cliente prohibidos; verificar que el árbol de producción pasa
- [x] 3.2 Añadir fixtures negativos para cada regla y verificar que cada violación informa archivo y motivo
- [x] 3.3 Verificar con búsqueda automatizada que packages no depende de budget y los módulos cliente no importan server/admin ni ejecutan CRUD de negocio

## 4. Integración

- [x] 4.1 Ejecutar npm test, npm run lint, npm run typecheck, npm run build y npm run test:e2e; corregir divergencias antes de revisión
- [x] 4.2 Ejecutar openspec validate decor-17-clean-architecture-boundaries --type change --strict y openspec validate --all --strict; corregir todos los hallazgos
