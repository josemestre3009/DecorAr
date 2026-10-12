# Design

## Context

El visor actual usa `<model-viewer>` para un activo y delega la experiencia AR a Quick Look, Scene Viewer o WebXR. Ya existe detección de `immersive-ar`, catálogo protegido y activos GLB HTTPS con dimensiones reales. `three` 0.183 está instalado, pero no existe un render loop WebXR propio ni tipos WebXR en el proyecto.

Este spike debe medir comportamiento real, no convertirse silenciosamente en el editor final. La evidencia decisiva solo puede obtenerse con HTTPS y hardware físico.

## Goals / Non-Goals

**Goals:**

- Aislar una sesión WebXR propia sin alterar el visor individual.
- Probar hit-test, clonación, selección, recolocación, giro y estabilidad con tres o más objetos.
- Capturar datos suficientes para repetir la prueba y tomar una decisión explícita.
- Mantener la lógica determinista de límites y transformaciones comprobable sin hardware.

**Non-Goals:**

- Persistencia, sincronización multiusuario, edición de paquetes o endpoints nuevos.
- Escaneo de habitación, oclusión, iluminación estimada, física, sombras dinámicas o auto-layout.
- Soporte WebXR en iOS; el fallback existente de Quick Look permanece fuera del spike.
- UI definitiva, selección de varios tipos de mueble o calidad de producción.

## Decisions

### Ruta experimental independiente

La prueba vivirá en una ruta protegida dedicada dentro del área de paquetes. No se reemplazará `model-viewer-client.tsx`; como máximo se añadirá un enlace explícito al spike.

Alternativa descartada: ampliar `<model-viewer>`. Su escena AR no expone el control requerido para administrar varios clones y mezclar el experimento arriesgaría una función existente.

### WebXR nativo sobre el renderer de Three.js

Un componente cliente creará `WebGLRenderer`, habilitará XR y solicitará `immersive-ar` con `hit-test` requerido y `dom-overlay` opcional. La referencia local y la fuente de hit-test se liberarán al finalizar la sesión.

Se reutilizará `three`, ya instalado. No se añadirá un framework XR: el spike solo necesita sesión, rayos, hit-test, carga GLB y transformaciones básicas.

### Un GLB cargado, clones independientes

`GLTFLoader` cargará una vez el activo seleccionado. Las instancias clonarán la escena y conservarán transformaciones independientes. El límite inicial será tres, suficiente para el criterio de salida; podrá elevarse manualmente durante la medición sin convertirse en configuración persistente.

Los modelos mantendrán escala 1. No habrá sombras dinámicas. Esto reduce variables durante la prueba y representa el alcance definido por DECOR-40.

### Máquina de estados pequeña y estado en memoria

La interfaz distinguirá `checking`, `unsupported`, `ready`, `starting`, `running` y `error`. La escena mantendrá en memoria sesión, hit-test, selección, instancias y muestras FPS. El desmontaje o evento `end` cancelará recursos y vaciará el estado.

La lógica pura de límite, selección y giro de 15 grados se separará del adaptador WebXR solo donde permita pruebas directas. No se crearán capas de dominio ni puertos destinados a una solución todavía no aprobada.

### Interacción probada por niveles

La colocación y recolocación usarán rayos XR y hit-test. Se registrarán `selectstart`, `selectend` y fuentes `transient-pointer` observadas. Si dos entradas simultáneas producen un ángulo estable, se aplicará giro continuo. Los botones de -15 y +15 grados serán el respaldo obligatorio cuando el navegador no entregue multitáctil útil.

Meta Quest usará sus controladores o manos mediante las mismas fuentes XR; no se asumirá equivalencia con eventos táctiles Android. La matriz distinguirá mecanismo y resultado.

### Diagnóstico visible, sin backend

Un DOM overlay, cuando esté concedido, mostrará funciones habilitadas, último evento, número de instancias y FPS aproximados mediante una ventana móvil. Si no hay overlay, el diagnóstico previo/posterior seguirá visible fuera de la sesión y los eventos quedarán en memoria para inspección al terminar.

No se añadirán analítica ni endpoints. Las evidencias externas serán capturas o video enlazados desde el documento de resultados y el work item.

### Protocolo y umbral de decisión

Cada dispositivo ejecutará el mismo guion: abrir por HTTPS, iniciar sesión, detectar piso, colocar tres clones, mover cada uno, girar por gesto si existe y por botones, mantener movimiento de cámara 60 segundos y registrar FPS mínimo/aproximado y fallos.

El umbral de viabilidad es al menos 30 FPS sostenidos, sin cierre de sesión, con tres clones manipulables. El resultado será:

- **Editor completo**: interacción directa estable en todas las plataformas probadas y rendimiento dentro del umbral.
- **Versión recortada**: colocación estable, pero algún gesto requiere controles discretos o hay diferencias documentadas por plataforma.
- **Descartar/replantear WebXR**: sesión, hit-test, manipulación básica o rendimiento fallan de forma crítica.

## Risks / Trade-offs

- [Los tipos TypeScript incluidos por `three` no cubren WebXR del navegador] -> declarar solo la superficie mínima usada o instalar tipos de desarrollo compatibles, sin abstraer toda la API.
- [Android depende de ARCore, permisos, origen seguro y versión del navegador] -> registrar versiones exactas y comprobar soporte antes de iniciar.
- [El DOM overlay puede no ser concedido] -> tratarlo como opcional y conservar controles XR y diagnóstico posterior.
- [Los eventos multitáctiles varían entre runtimes] -> registrar fuentes reales y mantener botones de giro como criterio aceptable para versión recortada.
- [Un FPS aproximado no sustituye profiling] -> usarlo solo como puerta del spike y conservar dispositivo, duración y carga constantes.
- [GLB pesado o CORS puede sesgar el resultado] -> usar un activo publicado conocido, confirmar CORS y registrar tamaño/version antes de la matriz.

## Migration Plan

No hay migración ni despliegue productivo requerido. El prototipo permanece en `spike/decor-40-webxr-scene` mientras se valida. Rollback: eliminar la ruta experimental y sus archivos; no existen datos que recuperar.
