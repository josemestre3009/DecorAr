# Proposal

## Why

El visor AR sitúa cada módulo siempre en el origen (`PrepararVistaARUseCase`, `src/modules/ar/application/use-cases/preparar-vista-ar.use-case.ts:54`): `InstanciaDecorativa` modela posición y rotación horizontal, pero nada las persiste. DECOR-23 dejó esto explícitamente fuera de alcance. Sin guardar la distribución, el decorador pierde el montaje de un paquete cada vez que cierra la sesión, y DECOR-47 (Mei) y DECOR-48 (Rafael), que dependen de esta tarea, no tienen un contrato estable de posición por el que construir.

## What Changes

- Añadir una tabla de escena por paquete (`package_scenes`) y una de posición por unidad (`package_item_transforms`), con `item_id` como clave, FK compuesta a `package_items` y borrado en cascada.
- Añadir una RPC `save_package_scene` (`SECURITY INVOKER`, solo `service_role`) que reemplaza todas las posiciones de un paquete en una transacción, bloqueando el paquete `FOR UPDATE`, comprobando la propiedad y un `expectedVersion` **propio de la escena**, separado de `packages.version`.
- Exponer `GET|PUT /api/packages/{packageId}/scene`, autorizado con `checkPackageAccess`, igual que el resto de endpoints de paquetes.
- Añadir dominio, puerto, casos de uso e infraestructura en `src/modules/ar` para validar y guardar la escena, reutilizando `Posicion3D` y la normalización de rotación de `InstanciaDecorativa`.
- Guardar la escena **no** emite eventos `package.module.*`, no toca `packages.version` ni `budgets`: mover objetos no recalcula el presupuesto (criterio de aceptación de DECOR-46).
- RLS de solo lectura para el propietario, igual que `package_items`; ninguna escritura directa desde el navegador.
- No añadir escala, inclinación, color, acceso público, ni copiar la escena al clonar un paquete o en las plantillas de DECOR-44: queda documentado como pendiente para una tarea futura.

## Capabilities

### New Capabilities

- `scene-transforms`: guardar y leer la posición y el giro horizontal de cada unidad de un paquete, de forma autorizada, versionada y sin afectar al presupuesto.

## Impact

- Dominio, puertos, casos de uso bajo `src/modules/ar/application` (nuevo) y `src/modules/ar/domain` (nuevo archivo).
- Infraestructura Supabase bajo `src/modules/ar/infrastructure` (nueva carpeta).
- Controlador bajo `src/interfaces/ar` (nueva carpeta), composición en `src/composition/server.ts`.
- Route Handler nuevo: `src/app/api/packages/[packageId]/scene/route.ts`.
- Migración `supabase/migrations/20261018000000_create_package_scene_transforms.sql` y su prueba PGlite.
- Sin cambios en `packages`, `budget` ni en los contratos de eventos existentes.
