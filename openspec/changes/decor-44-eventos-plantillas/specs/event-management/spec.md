# Spec Delta

## Purpose

Permite gestionar trabajos de clientes como eventos aun cuando los datos del lugar estén incompletos, manteniendo la configuración decorativa editable y segura.

## ADDED Requirements

### Requirement: Evento mínimo con nombre obligatorio
El sistema SHALL permitir a un decorador autenticado crear un evento indicando únicamente un nombre válido. El nombre MUST eliminar espacios exteriores, contener al menos un carácter visible y no superar 120 caracteres. Ningún otro dato SHALL ser obligatorio para crear o configurar el evento.

#### Scenario: Crear evento solo con nombre
- **WHEN** un decorador autenticado crea un evento con un nombre válido y omite los demás datos
- **THEN** el sistema crea el evento y permite abrir su configurador sin solicitar espacio ni área

#### Scenario: Rechazar nombre vacío
- **WHEN** el decorador intenta crear un evento con un nombre vacío o compuesto solo por espacios
- **THEN** el sistema muestra un error asociado al campo y no crea ningún registro

#### Scenario: Rechazar nombre demasiado largo
- **WHEN** el decorador intenta crear un evento cuyo nombre supera 120 caracteres
- **THEN** el sistema muestra un error asociado al campo y no crea ningún registro

### Requirement: Metadatos opcionales y editables
El sistema SHALL permitir consultar y modificar el nombre, cliente, fecha, lugar, tipo de evento, tipo de espacio y área disponible de un evento. Cliente, fecha, lugar, tipo de evento, tipo de espacio y área disponible SHALL admitir ausencia y eliminación posterior sin reconstruir ni borrar la configuración decorativa.

#### Scenario: Completar datos después de crear
- **WHEN** el propietario agrega metadatos opcionales a un evento existente
- **THEN** el sistema conserva módulos, cantidades, zonas, jerarquía y preferencias y devuelve los metadatos actualizados

#### Scenario: Quitar datos opcionales
- **WHEN** el propietario elimina el tipo de espacio o el área disponible de un evento
- **THEN** el sistema guarda ambos campos como ausentes y conserva la configuración decorativa

#### Scenario: Datos opcionales inválidos
- **WHEN** el propietario proporciona una fecha inválida, un valor de área no positivo o texto que excede el límite publicado por el contrato
- **THEN** el sistema rechaza la actualización con errores identificables sin modificar el evento

### Requirement: Configuración con zonas opcionales
El sistema SHALL permitir agregar módulos del catálogo en la raíz de un evento o dentro de zonas opcionales, conservando cantidades y hasta tres niveles de jerarquía. La ausencia de zonas MUST NOT impedir configurar el evento.

#### Scenario: Agregar módulo sin zona
- **WHEN** el propietario agrega un módulo a un evento sin zonas
- **THEN** el sistema guarda el módulo en la raíz del evento

#### Scenario: Organizar módulos en zonas
- **WHEN** el propietario crea zonas y agrega módulos dentro del límite jerárquico
- **THEN** el sistema conserva nombres, cantidades y relaciones padre-hijo

### Requirement: Compatibilidad espacial informativa
El sistema SHALL calcular el área requerida por la configuración sin usarla como condición para guardar. El diagnóstico SHALL ser `pending` cuando no exista área disponible, `compatible` cuando el área requerida no la supere y `exceeded` cuando la supere; cuando existan medidas, SHALL informar área disponible y requerida.

#### Scenario: Área desconocida
- **WHEN** se agrega un módulo a un evento sin área disponible
- **THEN** el cambio se guarda y el sistema indica "Compatibilidad espacial pendiente"

#### Scenario: Área suficiente
- **WHEN** el área requerida es menor o igual al área disponible
- **THEN** el cambio se guarda y el diagnóstico indica compatibilidad con ambas medidas

#### Scenario: Área excedida
- **WHEN** un cambio hace que el área requerida supere el área disponible
- **THEN** el cambio se guarda y el sistema muestra una advertencia con ambas medidas

### Requirement: Listado privado y terminología de eventos
La pantalla principal SHALL listar por separado los eventos del decorador y sus plantillas privadas. La experiencia de usuario SHALL usar "evento" y "plantilla"; MUST NOT presentar "paquete" como concepto de producto. Un evento ajeno o inexistente SHALL responder como no encontrado.

#### Scenario: Ver eventos propios
- **WHEN** un decorador abre la pantalla principal
- **THEN** ve únicamente sus eventos con nombre y metadatos disponibles separados de sus plantillas

#### Scenario: Sin eventos
- **WHEN** el decorador todavía no tiene eventos
- **THEN** la pantalla muestra un estado vacío y una acción para crear el primero

#### Scenario: Acceso a evento ajeno
- **WHEN** un decorador solicita un evento de otro propietario
- **THEN** el sistema responde como si el evento no existiera sin revelar sus datos

### Requirement: Migración compatible de paquetes existentes
El sistema MUST conservar identificadores, rutas, configuración, propietario y datos espaciales de todos los paquetes existentes. La migración SHALL asignar un nombre legible y determinista a registros sin nombre, y SHALL convertir tipo de espacio y área en datos opcionales sin descartarlos.

#### Scenario: Migrar paquete existente
- **WHEN** se aplica la migración a un paquete creado antes del cambio
- **THEN** el mismo identificador abre un evento nombrado con su configuración y datos espaciales intactos

#### Scenario: Repetir migración
- **WHEN** la migración se evalúa nuevamente sobre datos ya migrados
- **THEN** no cambia nombres existentes ni duplica o elimina configuración
