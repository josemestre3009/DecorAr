# Design

## Context

DECOR-17 creó el módulo `events` como marcador documentado y la regla que impide a `packages` depender de `budget`. Esta tarea fija el primer contrato funcional que productor, consumidor y frontend comparten. Véase `proposal.md` para la motivación y el spec para el contrato.

## Goals / Non-Goals

**Goals:**

- Una única definición importable de los tipos de evento, su validación y el nombre del canal.
- Rechazo controlado, sin excepciones, de eventos incompletos o de versión desconocida.
- Un puerto de publicación suficiente para que la integración posterior no invente otro formato.

**Non-Goals:**

- Publicar, consumir, reintentar o persistir eventos (outbox).
- Configurar RLS, Realtime o autenticación del canal.
- Soportar versiones distintas de `1` o migraciones entre versiones.
- Añadir UI, endpoints o dependencias.

## Decisions

### Contrato en el dominio del módulo events

Tipos, validación, ejemplos y canal viven en `src/modules/events/domain`, sin dependencias externas. El frontend, Paquetes y Presupuesto pueden importarlo sin violar las reglas de arquitectura, y Paquetes no conoce a Presupuesto.

Alternativa descartada: `src/shared`. El contrato es propio de la capacidad de eventos, no una primitiva transversal.

### Sobre plano con payload por tipo

Cada evento tiene `eventId`, `type`, `schemaVersion`, `occurredAt` (ISO 8601 UTC), `userId`, `packageId` y `payload`. Los identificadores y la fecha permiten reconocer el origen y apoyan la idempotencia por `eventId`. Los payloads son mínimos: los módulos de paquetes llevan `itemId` y `moduleId`; `budget.recalculated` lleva `budgetId`, `totalCop` entero y `causationEventId` que referencia el evento que provocó el recálculo. Presupuesto relee el paquete persistido, por lo que no se transportan precios ni cantidades en los eventos de paquete.

Alternativa descartada: payloads con el estado completo del paquete. Duplicaría la fuente de verdad y aumentaría el acoplamiento.

### Validación manual con Result

`parseDomainEvent(input: unknown)` devuelve `Result<DomainEvent, DomainError>`. Los códigos `event.invalid` y `event.unsupported_version` distinguen el motivo, y el mensaje nombra el campo o la versión recibida. La versión se comprueba antes del payload para que un cambio de versión no se reporte como campo faltante. `schemaVersion` debe ser exactamente el número JSON `1`; la cadena `"1"` se rechaza.

Alternativa descartada: Zod u otra biblioteca de esquemas. Tres eventos no justifican una dependencia nueva.

### Puerto EventPublisher en aplicación

`EventPublisher.publish(event): Promise<void>` vive en `src/modules/events/application`. Sus adaptadores concretos se añadirán en infraestructura en una tarea posterior.

## Risks / Trade-offs

- [Un payload mínimo puede quedarse corto] -> Ampliarlo sólo con una nueva versión explícita y su spec.
- [La validación manual puede divergir de los tipos] -> Las pruebas validan el ejemplo de cada tipo y cada campo obligatorio.

## Migration Plan

Cambio aditivo sin datos ni APIs que migrar. La reversión consiste en revertir la rama.
