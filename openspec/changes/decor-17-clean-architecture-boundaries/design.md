# Design

## Context

La aplicación contiene App Router y tres fábricas Supabase bajo `src/lib`, pero todavía no tiene módulos de negocio ni reglas de dependencia. Las tareas bloqueadas por DECOR-17 serán desarrolladas en paralelo por distintos colaboradores. Véase `proposal.md` para la motivación y los specs para el contrato.

## Goals / Non-Goals

**Goals:**

- Proporcionar ubicaciones estables para código futuro sin inventar lógica de negocio.
- Hacer ejecutables las reglas arquitectónicas con herramientas ya instaladas.
- Conservar la separación browser, sesión server-side y administración establecida por DECOR-16.

**Non-Goals:**

- Crear endpoints diagnósticos o verticales ficticios.
- Definir entidades, eventos, repositorios o casos de uso que pertenecen a tareas posteriores.
- Añadir SQL, RLS, Cloudinary, autenticación funcional o microservicios.

## Decisions

### Módulos verticales con capas internas

Cada capacidad vive bajo `src/modules/<module>` y añade `domain`, `application` o `infrastructure` sólo cuando contiene un contrato real. `src/shared` contiene primitives y puertos transversales; `src/interfaces` queda reservado para adaptadores de entrada y `src/composition` para cableado.

Alternativa descartada: capas globales `src/domain`, `src/application` y `src/infrastructure`. Coinciden literalmente con una lista académica, pero dispersan cada funcionalidad y aumentan conflictos entre colaboradores.

### Contratos mínimos, no esqueletos vacíos

Se implementan `DomainError`, `Result`, `Clock`, `IdGenerator` y `Logger`. Los módulos exponen únicamente marcadores documentados hasta que sus tareas propietarias añadan entidades y puertos específicos. No se crean interfaces de repositorio sin consumidor.

Alternativa descartada: predefinir todos los repositorios y casos de uso. Congelaría contratos sin requisitos funcionales suficientes.

### Infraestructura compartida para clientes Supabase

Las fábricas existentes se mueven a `src/infrastructure/supabase`. El cliente browser continúa separado porque Auth y Realtime son capacidades de plataforma; los clientes server y admin importan `server-only`. Los adaptadores de negocio futuros vivirán dentro de cada módulo y usarán estas fábricas.

Alternativa descartada: duplicar una fábrica Supabase por módulo. Añadiría configuración repetida sin mejorar el límite de negocio.

### Composition root server-only

`src/composition/server.ts` será el único lugar para seleccionar adaptadores concretos. Inicialmente expone las fábricas de clientes existentes; crecerá sólo cuando existan puertos reales.

Alternativa descartada: contenedor de inyección de dependencias. No existe complejidad que justifique una dependencia o abstracción adicional.

### Prueba estática con Node y TypeScript instalados

Una prueba Vitest usa el AST del compilador TypeScript instalado para extraer imports estáticos y dinámicos, resolver alias internos y aplicar reglas por ubicación/directiva. Fixtures controlados ejercitan cada rechazo. No se añade una herramienta de arquitectura.

Alternativa descartada: dependency-cruiser u otro paquete. Las reglas actuales son pequeñas y no justifican otra dependencia.

## Risks / Trade-offs

- [El análisis estático no sigue todo el grafo de módulos ni nombres de tabla calculados] -> Validar imports directos y literales; ampliar el análisis sólo ante un caso real.
- [Directorios inicialmente pequeños parecen ceremoniales] -> Crear sólo archivos con contrato o documentación útil; prohibir barrels y repositorios ficticios.
- [Mover las fábricas cambia imports internos] -> Actualizar las pruebas existentes y verificar typecheck/build; no hay consumidores externos publicados.
- [Una regla estricta puede bloquear una colaboración legítima futura] -> Cambiar la regla y su spec explícitamente cuando exista un caso requerido, no mediante excepciones silenciosas.

## Migration Plan

1. Archivar DECOR-16 para establecer specs base.
2. Mover fábricas y pruebas Supabase sin alterar su comportamiento.
3. Añadir contratos, estructura, composition root y documentación.
4. Añadir y ejecutar la prueba de arquitectura sobre producción y fixtures negativos.
5. Ejecutar todos los gates existentes y validación OpenSpec strict.

La reversión consiste en revertir la rama; no existen datos ni APIs que migrar.
