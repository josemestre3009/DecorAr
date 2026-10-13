# Entrega 1 – Implementación del MVP

Cada grupo deberá construir un **MVP funcional** alineado con la arquitectura aprobada.

Debe incluir:

## 8.14. Código fuente

El código fuente debe estar:

- Organizado.
- Coherente con el estilo asignado.
- Estructurado con **Clean Architecture**.

## 8.15. Implementación real de patrones

Los patrones no pueden quedarse únicamente en el documento.

Deben tener **evidencia funcional** en:

- El código.
- Los flujos del sistema.

## 8.16. Estructura Clean Architecture visible

Se debe mostrar claramente la separación y organización de:

- Carpetas o módulos.
- Casos de uso.
- Entidades.
- Adaptadores.
- Repositorios.
- Controladores o handlers.
- Infraestructura desacoplada.

## 8.17. API o interacción funcional

El sistema debe contar con una interacción funcional que incluya:

- Endpoints funcionales.
- Eventos, si aplica.
- Servicios accesibles o una demo operativa.

## 8.18. Manejo de errores

Se debe implementar y evidenciar:

- Logs.
- Respuestas controladas.
- Manejo de excepciones.
- Evidencias de fallos y recuperación, cuando aplique.

## 8.19. README técnico

El proyecto debe incluir un `README.md` técnico que explique:

- Cómo ejecutar el sistema.
- Cómo está organizado.
- Cómo se evidencia **Clean Architecture**.
- Qué patrones fueron implementados.
- Qué decisiones se tomaron.

---

# Exposición y defensa técnica

Cada grupo presentará su solución final y defenderá su arquitectura.

## Defensa individual

Cada estudiante debe explicar:

- Su patrón arquitectónico.
- El problema arquitectónico que resuelve.
- Cómo fue implementado.
- Qué *trade-offs* introduce.
- Cómo convive con **Clean Architecture**.

## Evidencias que debe mostrar el grupo

Durante la presentación, el grupo debe mostrar:

- Arquitectura final documentada en **C4 Model**.
- Coherencia entre documento y código.
- Demo funcional.
- Evidencia de patrones.
- Evidencia de separación en capas.

---

## Evidencia de cumplimiento (esta entrega)

| Criterio | Evidencia |
|---|---|
| 8.14 Código fuente | Monolito modular Next.js con límites de Clean Architecture (`docs/architecture.md`). |
| 8.15 Implementación real de patrones | Composite, Builder, Prototype, Bridge y Flyweight con código y pruebas (`docs/DecorAR.md` §4 y §2.2.7). |
| 8.16 Clean Architecture visible | Capas y reglas verificadas por `scripts/scan-architecture.test.ts` (`docs/architecture.md`). |
| 8.17 API o interacción funcional | Endpoints de evento, zona e instancia y eventos de dominio (`docs/DecorAR.md` §2.2.3, §2.2.4 y §2.2.10). |
| 8.18 Manejo de errores | Envelope `{error:{code,message}}`, `x-correlation-id`, outbox y recuperación (`docs/DecorAR.md` §2.2.5 y §2.2.6). |
| 8.19 README técnico | `README.md` y `src/modules/packages/README.md`. |

Composite editable: `POST /api/packages/{id}/groups`, `PATCH|DELETE /api/packages/{id}/groups/{groupId}` y `PATCH /api/packages/{id}/items/{itemId}` con autorización `checkPackageAccess` y RLS de lectura del propietario, RPC atómicas `create_package_group`, `update_package_group`, `delete_package_group` y `move_package_item`, outbox y presupuesto con `package.module.moved`. Las plantillas privadas de DECOR-44 siguen copiando la jerarquía editada con IDs nuevos.