# DECOR-45: Resultados de la validación WebXR multiobjeto en Android real

## Estado

Implementación automatizada lista. Validación física en dispositivos Android reales pendiente.

No declarar soporte completo hasta haber completado las pruebas en los dispositivos previstos. La ausencia de mediciones cuenta como evidencia incompleta, no como resultado positivo.

**Bloqueo actual**: no hay dispositivo compatible con ARCore disponible (ver "Dispositivo descartado"). Los criterios de validación física y la decisión continuar/recortar/solo 3D siguen pendientes. La matriz permanece vacía a propósito.

---

## Dispositivo descartado: POCO X6 Pro

El POCO X6 Pro de Rafael NO figura en la lista oficial de dispositivos compatibles con ARCore (consultada en nov-2026), por lo que no sirve como evidencia de esta validación.

Fuentes:
- Lista oficial: https://developers.google.com/ar/devices
- Soporte POCO: https://c.po.co/global/post/121296
- Issue: https://github.com/google-ar/arcore-android-sdk/issues/1744

Dispositivos de la lista oficial utilizables: Pixel 6a/7a o superior, Samsung Galaxy A54/A55 y serie S recientes, Redmi Note 13 Pro+, Redmi Note 14, POCO X5 Pro / X7 Pro / X8 Pro, Xiaomi 13T/14T.

Emuladores, granjas de dispositivos e IWER solo validan el ciclo de vida de la sesión, no FPS, memoria ni hit-test reales; no sustituyen la prueba física.

---

## Método de medición

- Los FPS en XR los marca el compositor; el contador del panel es orientativo.
- `performance.memory` es solo heap JS (Chromium), no memoria GPU.
- `renderer.info` aporta geometrías, texturas, draw calls y triángulos.
- Para evidencia fiable: `chrome://inspect` remoto, `adb shell dumpsys gfxinfo <paquete>` y `adb shell dumpsys meminfo <paquete>`, o Perfetto.
- Reportar siempre: dispositivo, versión de Chrome, versión de ARCore y número de instancias.
- Versión mínima de Chrome: sin fuente oficial confirmada; no se fija.
- Los GLB de Cloudinary deben responder con CORS.
- Riesgo abierto: `SkinnedMesh` con `clone(true)`; usar `SkeletonUtils.clone` si algún modelo del catálogo lleva huesos (no verificable desde el repo).

## Pendiente de hardware

- Pruebas con 1/5/10/20 objetos en al menos un dispositivo de la lista oficial.
- Adjuntar evidencia (capturas/video + tabla) en Plane.
- Decisión final para DECOR-46.
- Ejecución del E2E de Playwright (falta instalar chromium).
- Alcance extra (gesto de dos dedos y botón Reiniciar) no validado en dispositivo.

---

## Preparación reproducible y túnel HTTPS

1. Node.js 22 o posterior e instalación de dependencias:
   ```bash
   npm install
   ```
2. Iniciar el servidor de desarrollo local:
   ```bash
   npm run dev
   ```
3. Exponer el puerto 3000 a través de un túnel HTTPS seguro (WebXR exige HTTPS y contexto seguro):
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
4. Abrir la URL HTTPS pública en el navegador Google Chrome de un dispositivo Android compatible con Google Play Services for AR (ARCore).
5. Iniciar sesión en DecorAR en el dispositivo.
6. Navegar a un módulo del paquete y acceder a la ruta de validación multiobjeto:
   `/packages/{packageId}/modules/{moduleId}/webxr-validation`
7. Verificar que los archivos GLB de los modelos 3D respondan con código `200`, encabezado `Content-Type: model/gltf-binary` y encabezado CORS `Access-Control-Allow-Origin: *`.

*Nota de seguridad*: No registrar contraseñas, tokens de sesión ni cookies en los reportes de prueba.

---

## Guion de prueba de 60 segundos

1. **Apertura y permisos**: Abrir la URL HTTPS de validación en Google Chrome en Android. Verificar que el panel indique que WebXR y la sesión `immersive-ar` son compatibles.
2. **Inicio de sesión**: Pulsar "Iniciar sesión AR". Conceder permiso de acceso a la cámara.
3. **Detección de piso**: Apuntar la cámara hacia una superficie plana con textura y buena iluminación hasta observar la retícula verde en el piso.
4. **Prueba 1 objeto**:
   - Tocar la retícula para colocar el primer objeto a escala 1:1.
   - Seleccionar el objeto tocándolo; pulsar `-15°` y `+15°` para verificar la rotación.
   - Arrastrar/mover el objeto seleccionándolo y tocando un nuevo punto de la retícula.
   - Observar el panel: registrar FPS y memoria.
5. **Prueba 5 objetos**:
   - Con la retícula de hit-test visible sobre el piso, seleccionar "5 objetos" en el selector objetivo.
   - Verificar la aparición de las 5 instancias: la primera en el centro de la retícula y las otras 4 en círculo concéntrico.
   - Constatar que la escena queda deseleccionada; pulsar la retícula para comprobar que permite añadir o interactuar directamente.
   - Mover la cámara alrededor de las 5 instancias durante 15 segundos.
   - Registrar FPS (actual, mín, prom), memoria, info de render (geom, tex, calls, tri) y estabilidad.
6. **Prueba 10 objetos**:
   - Con la retícula visible, seleccionar "10 objetos" en el selector objetivo.
   - Mantener el tracking durante 15 segundos moviendo el dispositivo alrededor del grupo.
   - Observar si se producen caídas de fotogramas o artefactos visuales.
7. **Prueba 20 objetos**:
   - Con la retícula visible, seleccionar "20 objetos" en el selector objetivo.
   - Realizar paneos de cámara durante 20 segundos para completar los 60 segundos de prueba.
   - Registrar FPS mínimos, FPS promedio acumulado, memoria heap reportada y llamadas de render.
8. **Exportación y cierre**:
   - Pulsar "Copiar diagnóstico JSON" para copiar las métricas finales.
   - Pulsar "Terminar sesión" y verificar que la cámara se desactiva y el estado vuelve a `ready` sin congelamiento ni fugas visibles de memoria.

---

## Matriz de pruebas físicas

| Dispositivo / Fabricante | Versión Android | Versión Chrome | Versión ARCore | Escenario (N objetos) | FPS Actual / Mín / Prom | Memoria JS | Renderer (Calls/Geom/Tex/Tri) | Activos Flyweight | Fallos / Pérdidas de tracking | Controles estables |
|---|---|---|---|---|---|---|---|---|---|---|
| Dispositivo 1 (Pendiente) | Pendiente | Pendiente | Pendiente | 1 objeto | - | - | - | - | - | - |
| Dispositivo 1 (Pendiente) | Pendiente | Pendiente | Pendiente | 5 objetos | - | - | - | - | - | - |
| Dispositivo 1 (Pendiente) | Pendiente | Pendiente | Pendiente | 10 objetos | - | - | - | - | - | - |
| Dispositivo 1 (Pendiente) | Pendiente | Pendiente | Pendiente | 20 objetos | - | - | - | - | - | - |
| Dispositivo 2 (Pendiente) | Pendiente | Pendiente | Pendiente | 1 objeto | - | - | - | - | - | - |
| Dispositivo 2 (Pendiente) | Pendiente | Pendiente | Pendiente | 5 objetos | - | - | - | - | - | - |
| Dispositivo 2 (Pendiente) | Pendiente | Pendiente | Pendiente | 10 objetos | - | - | - | - | - | - |
| Dispositivo 2 (Pendiente) | Pendiente | Pendiente | Pendiente | 20 objetos | - | - | - | - | - | - |

---

## Reglas de decisión

- **Continuar con WebXR multiobjeto para DECOR-46**:
  - Se sostienen al menos **30 FPS estables** durante los 60 segundos con hasta 10 objetos.
  - La sesión `immersive-ar`, el hit-test y la colocación funcionan fluidamente sin congelamientos del navegador ni errores de asignación de memoria.
  - Los controles táctiles o botones de rotación responden correctamente.

- **Versión recortada**:
  - El rendimiento es adecuado (>= 30 FPS) con 1 y 5 objetos, pero con 10 o 20 objetos los FPS caen por debajo de 25 o la memoria se satura.
  - Se limitaría el alcance de la escena a un máximo estricto de 3 o 5 objetos concurrentes.

- **Solo vista 3D (Descartar WebXR multiobjeto)**:
  - Falla crítica en la inicialización de sesiones WebXR en dispositivos estándar, imposibilidad de realizar hit-test de piso estable, o caídas recurrentes por debajo de 20 FPS con más de 1 objeto. Se mantendría únicamente el visor 3D individual existente con `<model-viewer>`.

- **Pendiente**:
  - Aún no se han ejecutado las mediciones físicas en dispositivos Android reales.
