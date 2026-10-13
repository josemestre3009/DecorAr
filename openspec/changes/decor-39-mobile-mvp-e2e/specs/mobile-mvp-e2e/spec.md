# Spec Delta

## Purpose

Verificación automatizada y repetible del flujo de demo del MVP en un dispositivo móvil emulado, contra la app en Docker y el Supabase alojado de pruebas.

## ADDED Requirements

### Requirement: Entorno de ejecución

La suite SHALL correr desde el host contra la app levantada con Docker compose. Sus valores son `baseURL` `http://127.0.0.1:3000` y el dispositivo Pixel 5. MUST esperar a que `GET /api/health` responda `{"status":"ok"}` antes de cualquier escenario.

#### Scenario: App no disponible

- **WHEN** no hay ninguna app que responda `/api/health` con `{"status":"ok"}`
- **THEN** el setup falla con un mensaje que indica levantar `docker compose`

#### Scenario: Imagen en modo simulado

- **WHEN** la imagen se construyó sin `NEXT_PUBLIC_DECOR_PACKAGES_API=live`
- **THEN** el setup falla y pide reconstruir en modo live

### Requirement: Seed idempotente

El seed SHALL ejecutarse en el servidor con `service_role`. SHALL dejar los usuarios A y B con el correo confirmado y sin paquetes, y SHALL verificar que arco, mesa y pista están activos con GLB y USDZ HTTPS. Las cuentas que crea SHALL llevar `app_metadata.decor_e2e_seed = true`. MUST NOT modificar datos de otros usuarios ni activar módulos.

#### Scenario: Dos ejecuciones seguidas

- **WHEN** el seed se ejecuta dos veces
- **THEN** ambas terminan con los mismos usuarios A y B y sin paquetes previos

#### Scenario: Cuenta existente sin la marca del seed

- **WHEN** el correo de A o de B pertenece a una cuenta sin `app_metadata.decor_e2e_seed = true`
- **THEN** el seed falla nombrando el correo antes de cualquier escritura: no cambia contraseñas, no confirma correos y no borra paquetes de A ni de B

#### Scenario: Catálogo incompleto

- **WHEN** falta un módulo requerido o su USDZ
- **THEN** el seed falla nombrando el módulo y remitiendo a `npm run catalog:publish-assets`

### Requirement: Flujo de demo móvil

Con la sesión de A (`storageState`), la suite SHALL crear un paquete con capacidad manual, agregar desde el catálogo, provocar la capacidad excedida, crear la Zona de bienvenida, verificar el presupuesto confirmado y su resincronización, duplicar el paquete y abrir la vista 3D.

#### Scenario: Capacidad excedida

- **WHEN** dos pestañas de A abren el mismo paquete de 30 m², una agrega una pista y la otra, con la vista obsoleta, pide otra pista
- **THEN** la API responde 422 `package.capacity_exceeded` y la pestaña obsoleta muestra "(32/30 m²)" sin agregar la pista ni cambiar el área usada
- **AND** al recargar, esa pestaña muestra solo la pista guardada (16/30 m²)

#### Scenario: Presupuesto confirmado

- **WHEN** el paquete tiene pista, arco y mesa
- **THEN** "Total confirmado" coincide con `totalCop` y `packageVersion` de `GET /api/packages/{id}/budget`

#### Scenario: Atributos AR

- **WHEN** se abre la vista 3D de la mesa en Android
- **THEN** `data-testid="model-viewer"` tiene el GLB del catálogo, `ar-modes="scene-viewer webxr"`, `ar-scale="fixed"` y `ar-placement="floor"`, y `data-testid="ar-launch"` es visible
- **AND** con el user agent de iPhone tiene `ios-src` con el USDZ y `ar-modes="quick-look"`

### Requirement: Acceso protegido

La suite SHALL comprobar que una sesión anónima no accede a páginas ni a la API de paquetes y que el usuario B no ve paquetes de A.

#### Scenario: Anónimo

- **WHEN** no hay sesión
- **THEN** las páginas protegidas redirigen a `/login` y `POST /api/packages` responde 401 `auth.unauthenticated`

#### Scenario: Usuario B

- **WHEN** B abre un paquete de A o su presupuesto
- **THEN** ambos responden 404

### Requirement: Evidencia de fallos

La suite SHALL conservar trace, captura y video de cada prueba que falle.

#### Scenario: Prueba fallida

- **WHEN** un escenario falla
- **THEN** `test-results/` contiene su trace, captura y video
