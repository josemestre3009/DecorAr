# DECOR-40: resultados del spike WebXR multiobjeto

## Estado

Implementación automatizada lista. Validación física pendiente.

No declarar soporte completo hasta completar las tres filas de la matriz. La ausencia de un dispositivo cuenta como evidencia incompleta, no como resultado positivo.

## Preparación reproducible

1. Usar Node.js 22 o posterior e instalar con `npm install`.
2. Ejecutar `npm run dev`.
3. Exponer `http://localhost:3000` mediante HTTPS, por ejemplo `cloudflared tunnel --url http://localhost:3000`.
4. Abrir la URL HTTPS en el dispositivo e iniciar sesión.
5. Abrir un módulo, pulsar "Probar escena multiobjeto (experimental)" y registrar dispositivo, sistema y versión exacta del navegador.
6. Confirmar que la URL GLB responde `200`, MIME `model/gltf-binary` y `Access-Control-Allow-Origin` compatible desde el dispositivo.

No registrar credenciales, cookies ni la URL temporal completa si contiene información sensible.

## Activo

Registrar antes de cada ejecución:

| Campo | Valor |
| --- | --- |
| Nombre | Pendiente |
| `assetId@version` | Pendiente |
| URL GLB pública | Pendiente |
| Tamaño descargado | Pendiente |
| Dimensiones reales | Pendiente |

## Guion de 60 segundos

1. Abrir la ruta experimental por HTTPS.
2. Confirmar que el diagnóstico identifica soporte `immersive-ar`.
3. Iniciar AR, conceder cámara y apuntar a un piso con textura e iluminación estable.
4. Confirmar retícula de hit-test y colocar el primer objeto.
5. Pulsar "Añadir objeto" y repetir hasta tener tres clones.
6. Seleccionar y recolocar cada clon sin mover los otros.
7. Probar giro con dos entradas; registrar eventos y resultado.
8. Probar obligatoriamente los botones `-15°` y `+15°` sobre la selección.
9. Mover la cámara alrededor de los tres objetos durante 60 segundos.
10. Registrar FPS aproximados, mínimo observado, cierre de sesión, pérdidas de tracking y evidencia.
11. Terminar la sesión; confirmar diagnóstico en cero y ausencia de posiciones al reiniciar.

## Matriz física

| Plataforma | Dispositivo/fabricante | SO | Navegador/versión | Sesión | Hit-test | 3 clones | Recolocar | Giro directo | Giro +/-15° | FPS aprox./mín. | 60 s estable | Evidencia | Limitaciones |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Android 1 | Pendiente | Pendiente | Chrome pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| Android 2, fabricante distinto | Pendiente | Pendiente | Chrome pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| Meta Quest | Pendiente | Pendiente | Meta Quest Browser pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |

## Validación automatizada

| Comando | Resultado |
| --- | --- |
| `npm run lint` | Pasó, sin errores |
| `npm run typecheck` | Pasó, sin errores |
| `npm test` | Pasó: 111 archivos, 981 pruebas; 1 archivo y 7 pruebas omitidas |
| `npm run test:e2e` | Pasó: 18 pruebas; 21 omitidas por ausencia de credenciales E2E, incluido el escenario autenticado del spike |
| `npm run build` | Pasó |

Las pruebas automatizadas validan estado, límites, degradación y UI. No certifican WebXR, cámara, tracking ni rendimiento físico.

## Regla de decisión

- **Editor completo**: las tres filas inician sesión, manipulan tres clones, sostienen al menos 30 FPS durante 60 segundos y ofrecen interacción directa estable.
- **Versión recortada**: las tres filas cumplen sesión, tres clones, recolocación y rendimiento, pero una o más requieren botones de giro o muestran diferencias de entrada documentadas.
- **Descartar/replantear WebXR**: falla de forma crítica sesión, hit-test, manipulación de tres clones o rendimiento.
- **Pendiente**: falta cualquier dispositivo, versión, medición o evidencia requerida.

## Recomendación

**Pendiente.** Falta validación física en dos fabricantes Android y Meta Quest.
