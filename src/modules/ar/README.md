# AR

- `domain`: representación independiente de motores de render.
- `application`: preparación de escenas y activos mediante puertos.
- `infrastructure`: integración con proveedores y plataformas AR, y persistencia de la escena (DECOR-46).

El módulo consume catálogo y contratos públicos. Desde DECOR-46 también persiste, mediante `infrastructure/supabase-escena-repository.ts`, la posición y rotación horizontal que el dominio ya validaba solo en memoria.

## Patrones (DECOR-23)

El dominio es TypeScript puro, por eso los componentes cliente pueden importarlo sin violar `scripts/scan-architecture.ts`.

### Flyweight (`docs/DecorAR.md` §4.5)

| Participante | Archivo | Papel |
|---|---|---|
| `Activo3DCompartido` | `domain/activo-3d-compartido.ts` | Estado intrínseco inmutable: `assetId`, `version`, GLB, USDZ, poster y dimensiones en metros. |
| `FabricaActivos3D` | `domain/fabrica-activos-3d.ts` | Caché por `assetId@vN`: N instancias del mismo activo comparten una referencia. |
| `InstanciaDecorativa` | `domain/instancia-decorativa.ts` | Estado extrínseco: posición, rotación y color. La escala es siempre 1. |

### Bridge (`docs/DecorAR.md` §4.4)

| Participante | Archivo | Papel |
|---|---|---|
| `ElementoAR` | `domain/elemento-ar.ts` | Abstracción: sabe qué es y sobre qué superficie va, y delega la presentación. |
| `MesaAR`, `ArcoAR`, `PistaAR` | `domain/elemento-ar.ts` | Abstracciones refinadas de los tres módulos del MVP (piso). |
| `RenderizadorAR` | `domain/renderizador-ar.ts` | Implementador: decide archivo y modo para la plataforma. |
| `RenderizadorQuickLook`, `RenderizadorSceneViewer`, `RenderizadorWebXR`, `RenderizadorSinAR` | `domain/renderizador-ar.ts` | Implementaciones concretas: USDZ en iOS, GLB en Android, WebXR y vista 3D sin AR. |

`application/use-cases/preparar-vista-ar.use-case.ts` une ambos patrones. La interfaz traduce la `ConfiguracionVisor` resultante a los atributos de `<model-viewer>` (`src/app/(protected)/packages/[packageId]/modules/[moduleId]/model-viewer-client.tsx`).

## Escena persistida (DECOR-46)

| Participante | Archivo | Papel |
|---|---|---|
| `EscenaMontaje` | `domain/escena-montaje.ts` | Valida la lista de `TransformacionItem` (posición + rotación por `itemId`), límites y duplicados. Reusa `Posicion3D` y la normalización de grados de `InstanciaDecorativa`. |
| `EscenaRepository` | `application/ports/escena-repository.port.ts` | Puerto `leer`/`guardar`. |
| `ObtenerEscenaUseCase`, `GuardarEscenaUseCase` | `application/use-cases/*.ts` | `GET`/`PUT` de `/api/packages/{packageId}/scene`. |
| `SupabaseEscenaRepository` | `infrastructure/supabase-escena-repository.ts` | Adaptador server-only sobre la RPC `save_package_scene` (`SECURITY INVOKER`, solo `service_role`). |

Guardar la escena **no** emite eventos `package.module.*`, no toca `packages.version` ni `budgets`: mover un objeto no recalcula el presupuesto. La escena tiene su propia versión (`package_scenes.version`), comparada con `expectedSceneVersion`. No se copia al clonar un paquete ni en las plantillas de DECOR-44 (ver `openspec/changes/decor-46-scene-transforms/design.md`).
