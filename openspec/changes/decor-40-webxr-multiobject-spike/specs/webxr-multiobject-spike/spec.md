# Spec Delta

## Purpose

Define un prototipo aislado y un protocolo reproducible para decidir si DecorAR puede ofrecer una escena AR WebXR con varios objetos manipulables.

## ADDED Requirements

### Requirement: Acceso experimental aislado
El sistema SHALL ofrecer una vista protegida identificada como experimental, separada del visor individual existente, y SHALL mantener intacto el flujo actual de `<model-viewer>`.

#### Scenario: Persona con sesión abre el spike
- **WHEN** una persona autenticada abre la ruta experimental desde un navegador compatible
- **THEN** ve el control para iniciar la prueba multiobjeto y una advertencia de que el contenido solo dura durante la sesión

#### Scenario: Persona sin sesión
- **WHEN** una persona sin sesión abre la ruta experimental
- **THEN** llega al flujo de autenticación existente

### Requirement: Detección y degradación de capacidades
La vista SHALL comprobar si el navegador admite una sesión AR inmersiva y SHALL explicar la limitación sin intentar iniciarla cuando no exista soporte.

#### Scenario: Sesión AR disponible
- **WHEN** el navegador confirma soporte para una sesión AR inmersiva
- **THEN** la vista habilita el inicio de la prueba y solicita detección de superficies

#### Scenario: Navegador sin WebXR AR
- **WHEN** el navegador no expone WebXR o rechaza el modo AR inmersivo
- **THEN** la vista no habilita el inicio y muestra que el dispositivo no permite ejecutar este spike

#### Scenario: Función opcional no disponible
- **WHEN** la sesión admite detección de superficies pero no admite la superposición de controles
- **THEN** la sesión puede continuar con interacción XR directa y la vista registra la limitación

### Requirement: Colocación multiobjeto limitada
Durante una sesión compatible, la persona SHALL poder colocar varias instancias del mismo activo sobre una superficie detectada, a escala fija 1:1, hasta el límite indicado por el contenido de prueba.

#### Scenario: Colocar varios clones
- **WHEN** existe una superficie detectada y la persona coloca instancias sin alcanzar el límite
- **THEN** cada acción añade una instancia independiente en la pose señalada y comparte el activo 3D ya cargado

#### Scenario: Límite alcanzado
- **WHEN** la cantidad de instancias alcanza el límite configurado
- **THEN** la vista deshabilita nuevas colocaciones e informa que se alcanzó el máximo

#### Scenario: Reiniciar sesión
- **WHEN** la persona termina o reinicia la sesión AR
- **THEN** todas las posiciones y rotaciones del spike se descartan

### Requirement: Manipulación con respaldo accesible
La persona SHALL poder seleccionar, recolocar y girar una instancia. La vista SHALL ofrecer controles de giro de 15 grados que no dependan de un gesto multitáctil.

#### Scenario: Seleccionar y recolocar
- **WHEN** la persona selecciona una instancia y señala otra posición válida
- **THEN** solo la instancia seleccionada se mueve a esa posición

#### Scenario: Giro mediante gesto disponible
- **WHEN** el dispositivo entrega una interacción de dos puntos estable sobre la instancia seleccionada
- **THEN** la orientación de esa instancia sigue el cambio angular del gesto

#### Scenario: Giro mediante respaldo
- **WHEN** la persona activa el control de giro izquierdo o derecho
- **THEN** la instancia seleccionada gira exactamente 15 grados en la dirección elegida

### Requirement: Diagnóstico local de la prueba
La vista SHALL mostrar durante la sesión las capacidades detectadas, eventos de interacción observados, cantidad de objetos y una medición de rendimiento, sin enviar ni persistir telemetría.

#### Scenario: Consultar diagnóstico
- **WHEN** la prueba está activa
- **THEN** el panel muestra plataforma, funciones concedidas, último tipo de evento, objetos activos y FPS aproximados

#### Scenario: Cerrar la página
- **WHEN** la persona cierra o recarga la página
- **THEN** el diagnóstico y el estado de la escena desaparecen sin escrituras remotas

### Requirement: Evidencia y decisión del spike
El spike SHALL producir una matriz de resultados para dos fabricantes Android distintos y Meta Quest, con navegador y versión, soporte de sesión, colocación, movimiento, giro, cantidad probada, FPS observado, evidencia, limitaciones y conclusión.

#### Scenario: Plataforma validada
- **WHEN** se completa una ejecución en un dispositivo físico
- **THEN** la matriz registra todos los campos, el procedimiento usado y una evidencia reproducible

#### Scenario: Resultado positivo
- **WHEN** las tres plataformas inician la sesión, colocan al menos tres clones, permiten recolocación y giro mediante gesto o respaldo, y sostienen al menos 30 FPS durante 60 segundos sin cierre de sesión
- **THEN** la recomendación puede ser construir el editor completo o una versión recortada según las limitaciones observadas

#### Scenario: Evidencia incompleta o fallo crítico
- **WHEN** falta una plataforma física, una sesión no inicia, no se pueden manipular tres clones o el rendimiento queda bajo 30 FPS de forma sostenida
- **THEN** la recomendación no declara soporte completo y documenta si corresponde recortar, repetir o descartar la solución WebXR
