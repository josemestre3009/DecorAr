# Tasks

## 1. Flyweight (`src/modules/ar/domain`)

- [x] 1.1 `activo-3d-compartido.ts`: activo inmutable con clave `assetId@vN`, URLs HTTPS y dimensiones mayores que 0; verificar con `activo-3d-compartido.test.ts`
- [x] 1.2 `fabrica-activos-3d.ts`: caché por `assetId`+`version`, conflicto sin sobrescribir; verificar con `fabrica-activos-3d.test.ts` (una carga para N instancias)
- [x] 1.3 `instancia-decorativa.ts`: posición, rotación, color y escala fija 1, inmutable; verificar con `instancia-decorativa.test.ts`

## 2. Bridge (`src/modules/ar/domain`)

- [x] 2.1 `renderizador-ar.ts`: Quick Look, Scene Viewer, WebXR y sin AR, con `ar-scale="fixed"` y `elegirRenderizador`; verificar con `renderizador-ar.test.ts`
- [x] 2.2 `elemento-ar.ts`: `ElementoAR`, `MesaAR`, `ArcoAR`, `PistaAR` y `crearElementoAR`; verificar con `elemento-ar.test.ts`
- [x] 2.3 `preparar-vista-ar.use-case.ts`: une Flyweight y Bridge; verificar con `preparar-vista-ar.use-case.test.ts`

## 3. Interfaz

- [x] 3.1 `_lib/ar-capabilities.ts`: iOS (incluido iPadOS), Android y WebXR; verificar con `ar-capabilities.test.ts`
- [x] 3.2 `_lib/catalog-client.ts`: `fetchCatalogModule(id)`; verificar con `catalog-client.test.ts`
- [x] 3.3 `model-viewer-client.tsx`: carga solo en el navegador, atributos con `setAttribute`, progreso, error, reintento e incompatibilidad; verificar con `model-viewer-client.test.tsx` y `model-viewer-client.registered.test.tsx`
- [x] 3.4 `module-viewer.tsx` y `page.tsx` con `await requireSessionUser()`; verificar con `module-viewer.test.tsx` y `route-inventory.test.ts`
- [x] 3.5 Enlace "Ver en 3D" en `module-card.tsx`; verificar con `package-catalog.test.tsx`
- [x] 3.6 Estilos en `globals.css` con los tokens existentes y sin desborde a 360 px
- [x] 3.7 `e2e/ar-viewer.spec.ts`: sesión requerida, atributos AR por plataforma, carga real del GLB, tres módulos, volver y módulo ausente

## 4. Documentación y evidencia

- [x] 4.1 `docs/DecorAR.md` §2.2.5 con diagramas de Bridge y Flyweight y límites
- [x] 4.2 `src/modules/ar/README.md` con los participantes de cada patrón
- [ ] 4.3 Evidencia manual en Android (Scene Viewer) y en iPhone (Quick Look): detectar superficie, colocar, mover, rotar y comparar el tamaño con las medidas
  - iPhone con Safari: Quick Look abre desde "Ver en tu espacio" (probado por Mei). Dentro de apps como WhatsApp no hay Quick Look y la vista pide abrir Safari.
  - Arco/pista: la v2 tenía geometría descentrada (arco a ~4,3 m del origen y 15 cm bajo el piso; pista 28,5 cm bajo el origen). Resuelto: arco v3 y pista v3 recentrados publicados (centro X/Z = 0, base Y = 0, misma escala); `mesa` v2 ya estaba centrada.
  - Pendiente: Android con Scene Viewer y grabación de la evidencia
