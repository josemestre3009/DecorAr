# Tasks

## 1. Aplicación base

- [x] 1.1 Crear el proyecto Next.js estable con App Router, `src`, TypeScript estricto y CSS nativo; verificar instalación con `npm ci` y `npm run typecheck`
- [x] 1.2 Configurar ESLint flat, Vitest y los scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test` y `test:e2e`; verificar que todos aparecen en `npm run`
- [x] 1.3 Implementar la portada responsive de DecorAR y su prueba de componente; verificar con `npm test`

## 2. Fronteras Supabase

- [x] 2.1 Crear `.env.example` y una utilidad de validación de entorno sin valores reales; verificar mediante pruebas de variables faltantes
- [x] 2.2 Crear las fábricas Supabase browser, server y admin con `server-only` para admin; verificar con lint y typecheck
- [x] 2.3 Añadir pruebas unitarias de configuración pública y administrativa; verificar que los errores identifican la variable ausente

## 3. Navegador y seguridad

- [x] 3.1 Configurar Playwright con un proyecto Chromium móvil y un smoke test de portada; verificar con `npm run test:e2e`
- [x] 3.2 Crear un script de escaneo de `.next/static` y conectarlo al build para rechazar secretos centinela; verificar un build limpio y una prueba negativa controlada

## 4. Integración

- [x] 4.1 Ejecutar `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` y `npm run test:e2e`; registrar cualquier limitación ambiental sin marcar checks no ejecutados como aprobados
- [x] 4.2 Ejecutar `openspec validate decor-16-nextjs-foundation --type change --strict` y `/opsx-verify` equivalente; corregir divergencias antes de revisión
