# Design

## Context

`InstanciaDecorativa` (`src/modules/ar/domain/instancia-decorativa.ts`) ya valida posición (`Posicion3D`) y rotación horizontal normalizada a [0, 360), pero vive solo en memoria: `PrepararVistaARUseCase` siempre crea la instancia en el origen. `package_items` (`supabase/migrations/20261007000000_create_event_outbox.sql:27-32`) ya da una fila con UUID propio a cada unidad, incluso cuando un módulo se agrega con cantidad > 1 (`AddModuleToPackageUseCase`, línea 80/94), así que no hace falta un concepto nuevo de identidad de unidad.

El presupuesto se recalcula a partir de eventos `package.module.*` consumidos por `ConsumePackageChangedEvent` (`src/modules/budget/application/consume-package-changed-event.use-case.ts`), que se disparan únicamente desde las RPC de `packages` que ya existen. Esta tarea no debe tocar esa cadena.

## Goals / Non-Goals

**Goals:**

- Guardar y leer `{x, y, z, rotationDeg}` por `item_id`, con límites validados en dominio y en SQL.
- Que guardar la escena sea atómico, autorizado y no dispare el recálculo de presupuesto.
- Reusar `Posicion3D` y la normalización de grados de `InstanciaDecorativa` en vez de duplicar reglas.
- Seguir el mismo patrón de capas, autorización, RLS y RPC `service_role` que el resto de `packages`.

**Non-Goals:**

- Escala, inclinación o color: fuera de alcance, como en DECOR-23.
- Acceso público/sin sesión a la escena (lo cubre DECOR-53 para la cotización, no para la escena).
- Copiar la escena al clonar un paquete o en las plantillas de DECOR-44. El clon nace sin escena; el cliente coloca por defecto.
- Un segundo editor 3D o cambios en la interfaz WebXR (DECOR-47/48 los consumirán, no los implementa esta tarea).

## Decisions

### 1. Versión propia de la escena, no `packages.version`

`save_package_scene` usa una columna `package_scenes.version`, comparada con `p_expected_version`, en vez de reusar `packages.version`. Si usara la versión del paquete, cada movimiento de un objeto subiría también la versión que el editor de zonas y el presupuesto observan, generando conflictos espurios con `move_package_item`/`update_package_group` y acoplando dos conceptos que cambian a ritmos distintos.

Alternativa descartada: una columna `scene_version` dentro de `packages`. Mismo problema: un solo contador para dos agregados que no deben interferir.

### 2. Reemplazo completo, no parches por unidad

El `PUT` envía todas las posiciones del paquete; la RPC borra e inserta de nuevo todas las filas de `package_item_transforms` para ese paquete, siempre dentro de la transacción. El tamaño ya está acotado porque un paquete admite como máximo 100 unidades por lote (`MAX_BATCH_QUANTITY`).

Alternativa descartada: `PATCH` por unidad. Añade más endpoints y no resuelve el conflicto de versión mejor que un reemplazo atómico; el criterio de aceptación solo exige que la distribución se recupere entera.

### 3. Ninguna conexión con eventos ni presupuesto

`save_package_scene` no llama a `insert_package_outbox_event` ni emite `package.module.*`. El caso de uso en TypeScript tampoco notifica a `PackageChangeConsumer`. Esto es intencional: el criterio "mover objetos no recalcula el presupuesto" se cumple por diseño, no por un filtro posterior.

Alternativa descartada: emitir un evento `package.item.moved` de solo auditoría. No lo pide ningún criterio de aceptación y ampliaría el contrato de eventos sin necesidad (cambio mínimo).

### 4. Origen propio del montaje, metros y grados

Las posiciones son relativas a un origen que el propio montaje define (no a la sesión WebXR, que cambia cada vez). Unidades: metros para x/y/z, grados para la rotación horizontal, igual que el resto del dominio AR. Límites: `x,z` en [-50, 50], `y` en [-1, 5], `rotationDeg` en [0, 360) tras normalizar. Estos límites se validan en el dominio TypeScript y se repiten como `CHECK` en SQL (defensa en profundidad, igual que el resto de `packages`).

### 5. Capas: `src/modules/ar`

El dominio (`EscenaMontaje`), el puerto (`EscenaRepository`) y los casos de uso (`ObtenerEscenaUseCase`, `GuardarEscenaUseCase`) viven en `src/modules/ar`, que reutiliza `Posicion3D`/`InstanciaDecorativa` ya existentes allí. La infraestructura Supabase vive en `src/modules/ar/infrastructure` (carpeta nueva, mismo patrón que `src/modules/budget/infrastructure`). El controlador HTTP vive en `src/interfaces/ar/scene-controller.ts`, siguiendo el mismo patrón que `src/interfaces/catalog`.

Alternativa descartada: ponerlo en `src/modules/packages`, junto a `move-package-item.use-case.ts`. Mezclaría la persistencia de posición AR, que no es parte del Composite ni afecta la estructura de zonas, con el módulo que sí la posee.

### 6. Autorización idéntica al resto de endpoints de paquete

`GET|PUT /api/packages/{packageId}/scene` llama primero a `checkPackageAccess(authorizePackageAccess, packageId)`, igual que `budget/route.ts` e `items/[itemId]/route.ts`. La RPC repite la comprobación de propiedad bajo el lock, como las demás RPC de `packages`. RLS en ambas tablas nuevas solo concede `SELECT` al propietario; ninguna escritura directa para `anon`/`authenticated`.

### 7. Sin copia en clonar ni en plantillas (decisión explícita, no omisión)

`clone_package` y las RPC de plantillas de DECOR-44 no se tocan. Un paquete clonado o instanciado desde plantilla nace sin fila en `package_scenes`; el cliente coloca cada unidad con la regla de posición por defecto. Esto se documenta aquí para que no se asuma persistencia donde no la hay.

## Risks / Trade-offs

- [Sin colocación por defecto definida para unidades sin escena guardada] → el dominio TypeScript devuelve `null`/ausente por unidad; la interfaz (fuera de esta tarea) decide cómo mostrarlo, por ejemplo una cuadrícula alrededor del origen.
- [Dos versiones distintas en un mismo paquete (`packages.version` y `package_scenes.version`) pueden confundir al cliente] → cada endpoint documenta cuál versión espera y devuelve; el cliente de escena nunca lee `packages.version`.
- [No copiar la escena al clonar puede sorprender a un usuario que clona un montaje ya colocado] → aceptado como no-goal explícito; se registra como trabajo futuro si se solicita.
- [Rafael y Mei (DECOR-47/48) bloqueados hasta que el contrato HTTP esté estable] → el contrato (`GET|PUT /scene`, forma del cuerpo, códigos de error) queda fijado en la spec delta antes de implementar, para que puedan avanzar con un doble simulado.

## Migration Plan

1. Migración SQL aditiva: tablas, `CHECK`, RLS, RPC `save_package_scene`. Sin tocar migraciones existentes.
2. Dominio (`EscenaMontaje`) y puerto (`EscenaRepository`) con pruebas unitarias.
3. Casos de uso `ObtenerEscenaUseCase`/`GuardarEscenaUseCase` con pruebas unitarias (dobles del puerto).
4. Infraestructura `SupabaseEscenaRepository` con pruebas unitarias (dobles del cliente Supabase).
5. Controlador `SceneController`, composición y Route Handler, con pruebas HTTP.
6. Prueba PGlite: aislamiento por propietario, límites, conflicto de versión, cascada, y que `packages.version`/`budgets` no cambian.
7. Documentación (`docs/architecture.md`, `src/modules/ar/README.md`) y verificación (lint, typecheck, pruebas afectadas).

Rollback: la migración es aditiva y no toca filas existentes; revertir es borrar las dos tablas nuevas y la RPC sin afectar `packages`, `package_items`, `budgets` ni el outbox.
