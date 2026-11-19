# Tasks

## 1. Dominio

- [x] 1.1 Crear `calculateQuote` con aritmética entera, tasas en puntos básicos y redondeo COP; verificar con pruebas de descuento, impuesto, anticipo, redondeo y valores inválidos.
- [x] 1.2 Crear `validarTerminosCotizacion` y la máquina de estados; verificar con pruebas de vigencia, tasas, textos y transiciones.

## 2. Persistencia

- [x] 2.1 Crear la migración con `quotes`, `quote_lines`, contador privado, CHECK, disparadores, RLS y RPC; verificar con la suite PGlite `decor-50-quotes.test.ts`.
- [x] 2.2 Registrar la suite en `vitest.config.ts` y limpiar las tablas en `supabase/reset-test-database.sql`; verificar con `npm test`.

## 3. Aplicación e infraestructura

- [x] 3.1 Crear puertos, DTO y casos de uso de crear, versionar, listar y cambiar estado; verificar con pruebas usando dobles.
- [x] 3.2 Crear lector de sesión, lector de instantánea y repositorio RPC; verificar mapeos y traducción de errores.

## 4. HTTP

- [x] 4.1 Crear `QuoteController`, `checkQuoteAccess`, Route Handlers y `createQuoteController`; verificar 401, 404 indistinguible, 409, 422 y 500 sin detalle.
- [x] 4.2 Añadir `quote`/`cotizacion` a las tablas de negocio del escáner de arquitectura; verificar con `scan-architecture.test.ts`.

## 5. Cierre

- [x] 5.1 Documentar el módulo en `src/modules/quotes/README.md`; verificar coherencia con nombres reales.
- [x] 5.2 Ejecutar `npm run lint`, `npm run typecheck` y `npm test`.
