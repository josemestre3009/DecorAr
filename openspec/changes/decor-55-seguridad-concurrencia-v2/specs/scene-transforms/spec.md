# Spec Delta

## MODIFIED Requirements

### Requirement: Conflicto de versión de escena
Guardar SHALL exigir la versión de escena esperada, tanto en la API como en la base de datos. Si la escena cambió desde la última lectura, o la versión esperada falta, el sistema MUST rechazar el guardado sin aplicar ningún cambio parcial.

#### Scenario: Versión de escena obsoleta
- **WHEN** se guarda con `expectedSceneVersion` distinto de la versión actual de la escena
- **THEN** el sistema responde 409 `scene.version_conflict`, no persiste ningún cambio y devuelve la versión actual

#### Scenario: Guardado sin versión esperada
- **WHEN** `save_package_scene` recibe una versión esperada nula o negativa
- **THEN** la base de datos rechaza el guardado con `scene.invalid_body` y la escena no cambia
