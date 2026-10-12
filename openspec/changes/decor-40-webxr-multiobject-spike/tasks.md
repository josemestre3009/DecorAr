# Tasks

## 1. Base experimental y lógica comprobable

- [x] 1.1 Añadir los tipos WebXR mínimos necesarios y confirmar que `npm run typecheck` acepta sesión, hit-test, fuentes de entrada y DOM overlay sin ampliar la API fuera del spike
- [x] 1.2 Implementar el estado en memoria para límite de tres instancias, selección, recolocación y giro de +/-15 grados; verificar límites, aislamiento de transformaciones y reinicio con una prueba unitaria
- [x] 1.3 Crear la ruta protegida experimental con estados `checking`, `unsupported`, `ready`, `starting`, `running` y `error`; verificar sesión requerida y degradación sin `navigator.xr` mediante pruebas de componente/ruta

## 2. Escena WebXR multiobjeto

- [x] 2.1 Crear el renderer cliente, solicitar `immersive-ar` con `hit-test` requerido y `dom-overlay` opcional, y liberar sesión, espacios y fuente de hit-test al terminar; verificar inicio, rechazo y cleanup con dobles de WebXR
- [x] 2.2 Cargar una sola vez un GLB HTTPS conocido, clonar hasta tres instancias a escala 1:1 y sin sombras dinámicas; verificar una carga para N clones y bloqueo al alcanzar el límite
- [x] 2.3 Implementar retícula, colocación, selección y recolocación por rayos/hit-test; verificar que solo cambia la instancia seleccionada con pruebas de la lógica de escena
- [x] 2.4 Registrar `selectstart`, `selectend` y fuentes `transient-pointer`, aplicar giro de dos entradas cuando sea estable y mantener botones de +/-15 grados; verificar gesto simulado y respaldo mediante pruebas

## 3. Diagnóstico y protocolo

- [x] 3.1 Añadir panel local con plataforma, funciones concedidas, último evento, objetos activos y FPS aproximados; verificar actualización, ausencia de llamadas remotas y limpieza al cerrar la sesión
- [x] 3.2 Ajustar la vista a móvil y Quest, con foco visible, controles táctiles accesibles y aviso experimental; verificar `npm run test:e2e` a 360 px y navegación por teclado fuera de la sesión inmersiva
- [x] 3.3 Crear `docs/spikes/decor-40-webxr-results.md` con prerrequisitos HTTPS, activo/version, guion de 60 segundos, matriz para dos fabricantes Android y Meta Quest, campos de evidencia y reglas de decisión; verificar que el procedimiento reproduce todos los escenarios del spec

## 4. Validación automatizada y física

- [x] 4.1 Ejecutar `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` y `npm run build`; registrar comandos y resultados exactos en el documento del spike
- [ ] 4.2 Exponer la rama por HTTPS con un túnel temporal, probar el GLB y CORS desde el dispositivo, y registrar URL no secreta, navegador, versión y preparación en el documento
- [ ] 4.3 Ejecutar el guion completo en Android Chrome de dos fabricantes distintos; registrar inicio, hit-test, tres clones, movimiento, giro directo/respaldo, FPS durante 60 segundos, fallos y evidencia por dispositivo
- [ ] 4.4 Ejecutar el mismo guion en Meta Quest; registrar mecanismo de entrada, tres clones, movimiento, giro, FPS durante 60 segundos, fallos y evidencia
- [ ] 4.5 Comparar la matriz con el umbral de 30 FPS y tres clones manipulables, escribir una única recomendación (`editor completo`, `versión recortada` o `descartar/replantear`) y publicar la síntesis reproducible en DECOR-40
