# Tasks

## 1. Persistencia y migración de eventos

- [x] 1.1 Crear la migración aditiva que añade nombre y metadatos opcionales a `packages`, relaja `space_type`/`capacity_m2`, hace backfill determinista y conserva IDs/configuración; verificar con una prueba PGlite de fixture pre-migración e idempotencia.
- [x] 1.2 Actualizar RPC, repositorios y lectores de paquetes para crear por nombre, leer/escribir metadatos nullable y mantener contratos existentes; verificar con pruebas de infraestructura y migración.
- [x] 1.3 Adaptar DTO, puertos y casos de uso de creación/edición/listado para validar nombre y metadatos sin tocar configuración; verificar con pruebas unitarias de éxito, limpieza, límites y ausencia.
- [x] 1.4 Añadir `PATCH /api/packages/{packageId}` y ampliar GET/POST preservando 401/404/envelopes; verificar con pruebas de controlador y Route Handler, incluida autorización A/B.
- [x] 1.5 Documentar en `docs/DecorAR.md` y el README del módulo el mapeo evento↔package y la migración compatible; verificar referencias contra rutas y contratos implementados.

## 2. Diagnóstico espacial no bloqueante

- [x] 2.1 Hacer opcionales tipo de espacio y capacidad en `PaqueteDecoracion`/`ConfiguracionEvento` y eliminar únicamente el rechazo por exceso; verificar con pruebas de dominio para área ausente, suficiente y excedida.
- [x] 2.2 Eliminar el prebloqueo de capacidad de los casos de uso de módulos/grupos y exponer `pending | compatible | exceeded` con área requerida/disponible; verificar con pruebas de aplicación que los cambios excedidos persisten.
- [x] 2.3 Actualizar detalle, controlador y respuestas HTTP para incluir el diagnóstico sin cambiar outbox, presupuesto ni concurrencia; verificar con integración API que el exceso responde éxito, incrementa versión y emite el evento esperado.
- [x] 2.4 Actualizar documentación del Composite y manejo de errores para distinguir validación de datos de advertencia espacial; verificar que no quede documentado `package.capacity_exceeded` como respuesta 422.

## 3. Persistencia segura de plantillas

- [x] 3.1 Crear tablas normalizadas de plantillas, grupos e ítems con restricciones, índices, cascada solo interna y RLS por propietario; verificar estructura, permisos anon/authenticated/service_role y aislamiento A/B con PGlite.
- [x] 3.2 Implementar RPC atómicas evento→plantilla y plantilla→evento con bloqueo consistente, mapeo de IDs y exclusión de cliente/fecha/lugar; verificar copia profunda, jerarquía, preferencias, nuevos IDs y rollback en ambos sentidos.
- [x] 3.3 Implementar lector/repositorio, DTO y casos de uso para listar, consultar, guardar, instanciar, renombrar y eliminar plantillas; verificar validación de nombres, independencia y que eliminar una plantilla no altere eventos.
- [x] 3.4 Añadir autorización explícita y controladores/Route Handlers de `/api/event-templates`; verificar 401 para anónimo, 404 indistinguible para ajeno/inexistente y operaciones completas del propietario.
- [x] 3.5 Registrar las suites PGlite necesarias en `vitest.config.ts` y actualizar la prueba de fronteras arquitectónicas para cubrir nuevos adaptadores; verificar ejecución aislada de esas suites y `npm run typecheck`.
- [x] 3.6 Documentar tablas, RPC, RLS, Prototype y política de borrado en `docs/DecorAR.md` y documentación técnica del módulo; verificar coherencia con nombres y permisos reales.

## 4. Experiencia de eventos

- [x] 4.1 Sustituir el formulario obligatorio de espacio por creación rápida con nombre y cliente HTTP actualizado; verificar errores inline accesibles, doble envío y navegación con pruebas de componente.
- [x] 4.2 Reorganizar `/packages` en secciones "Eventos" y "Plantillas" con carga, error y estados vacíos independientes, preservando diseño responsive; verificar render desktop/móvil y que la UI no muestre "paquete" como producto.
- [x] 4.3 Añadir edición progresiva de metadatos al configurador sin reconstruir contenidos; verificar guardar, limpiar campos, errores recuperables, foco y conservación del árbol con pruebas frontend.
- [x] 4.4 Reemplazar el resumen rígido por el diagnóstico espacial pendiente/compatible/excedido con medidas cuando existan; verificar anuncios accesibles y persistencia visual tras agregar módulos.
- [x] 4.5 Actualizar terminología de navegación, catálogo, presupuesto, autenticación y AR a "evento" donde sea visible, sin cambiar URLs técnicas; verificar pruebas de texto y navegación existentes.

## 5. Experiencia de plantillas

- [x] 5.1 Añadir cliente HTTP y acción "Guardar como plantilla" en el configurador con nombre obligatorio; verificar éxito, error, teclado, foco visible, retorno de foco y anuncio `aria-live`.
- [x] 5.2 Implementar tarjetas de plantillas con usar, renombrar y eliminar, incluidas confirmaciones y estados pendientes por acción; verificar estados vacío/error/éxito y accesibilidad con pruebas de componente.
- [x] 5.3 Implementar creación de evento desde plantilla solicitando nombre y navegando al nuevo configurador; verificar que datos específicos estén vacíos y que cambios posteriores no afecten la plantilla.
- [x] 5.4 Ejecutar una revisión visual acotada desktop/móvil y el detector Impeccable sobre objetivos UI modificados; corregir hallazgos materiales y verificar una única confirmación posterior. Verificado junto al editor de zonas: desktop/móvil sin overflow ni defectos materiales; detector Impeccable limpio tras corregir el fallback de imagen.

## 6. Integración y entrega

- [x] 6.1 Añadir E2E live del recorrido evento mínimo → configurar → guardar plantilla → crear segundo evento → demostrar independencia; verificar además teclado y mensajes accesibles en desktop y móvil. Verificado: 2/2 casos Playwright live aprobados.
- [x] 6.2 Extender la integración A/B alojada para listar, consultar, usar, renombrar y eliminar plantillas, más rechazo de escrituras directas; verificar con `DECOR_RLS_INTEGRATION=1` cuando haya credenciales. Verificado: 10/10 casos alojados aprobados.
- [x] 6.3 Actualizar `docs/Actividad.md`/documentación de arquitectura con evidencias Clean Architecture, API, errores, Prototype y Composite; verificar que cada afirmación apunte a código o prueba real.
- [x] 6.4 Ejecutar `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` y la E2E live aplicable; registrar resultados exactos y cualquier validación manual pendiente. Lint, typecheck y build correctos; 132 archivos/1152 pruebas aprobadas; E2E live 2/2 y autorización A/B 10/10 aprobadas.
