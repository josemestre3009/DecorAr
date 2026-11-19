# Proposal

## Why

El decorador necesita entregar al cliente una cotización que no cambie cuando más tarde edite el evento o cuando cambien los precios del catálogo. Hoy DecorAR solo calcula un presupuesto "en vivo" sobre `catalog_modules`, sin número, versión, términos comerciales ni historial. DECOR-50 crea esa base; vista previa (DECOR-51), PDF (DECOR-52) y enlace público (DECOR-53) dependen de ella.

## What Changes

- Guardar cada cotización como una instantánea inmutable de un evento: líneas con nombre, cantidad y precio congelados, datos del cliente y del evento, vigencia, descuento, impuesto, anticipo, total y condiciones.
- Asignar a cada cotización un número por propietario y una versión; crear una versión nueva toma otra vez el evento actual y nunca altera las anteriores.
- Calcular siempre los totales en servidor con aritmética entera en COP y redondeo al peso.
- Definir los estados borrador, enviada, aceptada y vencida con transiciones validadas.
- Exponer una API autenticada para crear, versionar, consultar, listar y cambiar el estado de cotizaciones, restringida al propietario.

## Capabilities

### New Capabilities

- `versioned-quotes`: Cotizaciones versionadas con precios congelados, totales calculados en servidor, estados y acceso exclusivo del propietario.

### Modified Capabilities

- Ninguna. Eventos, presupuesto, plantillas y AR no cambian.

## Impact

- Nuevo módulo `src/modules/quotes` (domain, application, infrastructure) que no importa `packages`.
- Nuevos `src/interfaces/quotes`, Route Handlers bajo `src/app/api/quotes` y `src/app/api/packages/[packageId]/quotes`, y la fábrica `createQuoteController` en `src/composition/server.ts`.
- Migración `20261018000000_create_quotes.sql`: tablas `quotes` y `quote_lines`, contador privado, disparadores de inmutabilidad, RLS y RPC `service_role`.
- `scripts/scan-architecture.ts` reconoce `quotes`/`cotizaciones` como tablas de negocio; `supabase/reset-test-database.sql` las limpia.
- Pruebas Vitest de dominio, aplicación, infraestructura, controlador y rutas, y suite PGlite registrada en `vitest.config.ts`.
- Sin dependencias nuevas.
