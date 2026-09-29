# Proposal

## Why

DecorAR necesita límites de Clean Architecture visibles antes de que varios colaboradores implementen catálogo, paquetes, eventos, presupuesto, autenticación y AR en paralelo. Sin una estructura y reglas automatizadas, esas tareas pueden acoplar dominio, framework y proveedores desde el inicio.

## What Changes

- Organizar el monolito Next.js en módulos verticales `catalog`, `packages`, `budget`, `events` y `ar` con capas internas explícitas.
- Añadir un shared kernel mínimo para errores, resultados y contratos transversales.
- Aislar Supabase tras adaptadores de infraestructura y centralizar el cableado server-side en un composition root.
- Prohibir dependencias desde dominio hacia frameworks o infraestructura, desde aplicación hacia infraestructura, y desde módulos cliente hacia adaptadores server-side.
- Prohibir CRUD directo de negocio desde módulos cliente y acoplamiento de `packages` hacia `budget`.
- Añadir documentación y una prueba automática de los límites de imports.

## Capabilities

### New Capabilities

- `clean-architecture-boundaries`: Estructura modular, dirección de dependencias, contratos compartidos, composition root y verificación automática de límites.

### Modified Capabilities

- `supabase-client-boundaries`: Restringe el cliente de navegador a Auth y Realtime, y exige que el acceso de negocio permanezca en adaptadores server-side.

## Impact

- Reorganiza las fábricas Supabase existentes bajo infraestructura y actualiza sus pruebas.
- Añade estructura bajo `src/modules`, `src/shared`, `src/interfaces` y `src/composition`.
- Añade una prueba de arquitectura y documentación de dependencias.
- No añade endpoints, migraciones SQL, entidades, casos de uso completos, microservicios ni dependencias npm.
