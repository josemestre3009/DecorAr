# Spec Delta

## Purpose

Define la vista 3D y el lanzamiento en realidad aumentada de un módulo del catálogo, a escala fija 1:1, con los patrones Bridge y Flyweight.

## ADDED Requirements

### Requirement: Vista 3D protegida por módulo
La página `/packages/{packageId}/modules/{moduleId}` SHALL exigir sesión y mostrar el módulo activo del catálogo obtenido con `GET /api/modules`.

#### Scenario: Persona sin sesión
- **WHEN** una persona sin sesión abre la vista 3D de un módulo
- **THEN** llega a `/login`

#### Scenario: Acceso desde el catálogo
- **WHEN** la persona pulsa "Ver en 3D" en una tarjeta del catálogo de su paquete
- **THEN** llega a `/packages/{packageId}/modules/{moduleId}` y ve el nombre, las medidas reales y el visor del módulo

#### Scenario: Módulo ausente
- **WHEN** el módulo no está entre los activos del catálogo
- **THEN** la vista anuncia "Este módulo ya no está disponible en el catálogo." y ofrece volver al catálogo, sin visor

### Requirement: Bridge entre elemento y plataforma AR
Cada módulo SHALL presentarse mediante su abstracción (`MesaAR`, `ArcoAR` o `PistaAR`), que delega en un `RenderizadorAR` elegido según el dispositivo sin cambiar el elemento.

#### Scenario: iPhone o iPad
- **WHEN** el dispositivo es iOS o iPadOS
- **THEN** el visor recibe `ios-src` con el USDZ y `ar-modes="quick-look"`

#### Scenario: Android
- **WHEN** el dispositivo es Android
- **THEN** el visor recibe el GLB en `src` y `ar-modes="scene-viewer webxr"`, sin `ios-src`

#### Scenario: Navegador sin AR
- **WHEN** el dispositivo no ofrece AR o `<model-viewer>` informa que no puede activarla
- **THEN** la vista conserva el modelo 3D girable y ofrece los enlaces del GLB y del USDZ
- **AND** no muestra los pasos para colocar el modelo, porque el botón "Ver en tu espacio" no existe
- **AND** en iPhone indica abrir la página en Safari, y en Android abrirla en Chrome con "Servicios de Google Play para RA"

### Requirement: Escala fija y colocación
El visor SHALL usar `ar-scale="fixed"` en todas las plataformas y `ar-placement="floor"` para mesa, arco y pista.

#### Scenario: Atributos verificables
- **WHEN** la vista está lista
- **THEN** el elemento `data-testid="model-viewer"` tiene `src`, `ar`, `ar-modes`, `ar-scale="fixed"` y `ar-placement`, y el botón `data-testid="ar-launch"` está en el slot `ar-button`

### Requirement: Flyweight de activos 3D
Los activos 3D SHALL compartirse por `assetId` y `version` mediante `FabricaActivos3D`; el estado propio de cada copia SHALL vivir en `InstanciaDecorativa`.

#### Scenario: N instancias, una carga
- **WHEN** se crean N instancias del mismo `assetId` y `version`
- **THEN** todas referencian el mismo `Activo3DCompartido` inmutable y la fábrica registra un solo activo creado

#### Scenario: Versión publicada inmutable
- **WHEN** llegan datos distintos con un `assetId` y `version` ya cargados
- **THEN** la fábrica responde `ar.asset_conflict` y conserva el activo original

### Requirement: Estados del visor
El visor SHALL cargar `@google/model-viewer` solo en el navegador y mostrar progreso, error con reintento y fallo de la sesión AR.

#### Scenario: Error de carga
- **WHEN** el modelo o la librería no cargan
- **THEN** la vista anuncia "No pudimos cargar el modelo 3D." y "Reintentar" crea un visor nuevo

### Requirement: Tarjeta del catálogo con acceso 3D
Cada tarjeta del catálogo SHALL incluir el enlace "Ver en 3D" hacia la vista 3D del módulo dentro del paquete actual.

#### Scenario: Enlace por módulo
- **WHEN** el catálogo muestra un módulo
- **THEN** su tarjeta enlaza a `/packages/{packageId}/modules/{moduleId}` con el nombre accesible "Ver {nombre} en 3D"
