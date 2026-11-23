# Spec: webxr-multiobject-validation

## 1. Context and Scope

Prototipo aislado para evaluar la viabilidad técnica y el rendimiento de WebXR multiobjeto en dispositivos Android reales con ARCore a escala real 1:1, evaluando escenarios de carga con 1, 5, 10 y 20 instancias y monitorización de recursos en tiempo real.

## 2. Requirements

### Requirement 1: Dominio puro de escena WebXR
- La entidad y funciones en `src/modules/ar/domain/escena-webxr.ts` deben ser inmutables y puras.
- No deben importar React, Next.js, Three.js ni dependencias externas.
- Las funciones deben devolver `Result<T, DomainError>` según los estándares de `src/shared/domain/result.ts`.
- El límite de instancias de la escena debe ser configurable (con soporte para al menos 20 objetos).

### Requirement 2: Flyweight y escala 1:1
- Debe integrarse con `FabricaActivos3D` e `InstanciaDecorativa`.
- Cada modelo 3D solo se descarga una vez y se clona para múltiples instancias en la escena.
- La escala debe mantenerse fija a 1:1.

### Requirement 3: Adaptador WebXR y Three.js
- Se debe abrir una única sesión `immersive-ar`.
- Debe detectar el piso mediante hit-test continuo y mostrar una retícula cuando una superficie es válida.
- Al salir o finalizar la sesión se deben liberar todos los recursos de Three.js (`geometry.dispose()`, `material.dispose()`, canvas del DOM y sesión XR).

### Requirement 4: Selector de carga y diagnósticos en vivo
- Debe incluir selector de 1, 5, 10 y 20 objetos. Exige retícula de hit-test visible para poblar (colocando el primer objeto sobre la retícula y los siguientes en círculo concéntrico), deseleccionando tras la operación para permitir nuevas colocaciones directas.
- El panel de diagnóstico en DOM overlay debe mostrar:
  - Plataforma y User Agent.
  - Funciones WebXR concedidas y estado de DOM overlay.
  - Conteo de objetos en escena vs cantidad objetivo.
  - FPS actual, mínimo y promedio acumulados en tiempo real.
  - Memoria JS aproximada vía `performance.memory` (o "n/d").
  - Estadísticas de `renderer.info` (geometrías, texturas, llamadas de render, triángulos).
  - Número de activos instanciados en el Flyweight.
  - Registro de fallos y último evento.
  - Botón para exportar/copiar el diagnóstico completo en formato JSON.

### Requirement 5: Degradación y accesibilidad
- Si el navegador o dispositivo no soporta WebXR o `immersive-ar`, se debe mostrar un mensaje claro con enlace de respaldo al visor 3D individual.
- La interfaz no debe causar desbordamiento horizontal en pantallas de 360 px.
- Los elementos interactivos deben poseer un indicador de foco visible accesible mediante teclado.
