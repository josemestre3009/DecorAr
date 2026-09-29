# Design

## Context

El repositorio contiene documentación y OpenSpec, pero todavía no una aplicación. `docs/DecorAR.md` exige Next.js estable, App Router, TypeScript estricto, Vitest, Playwright y acceso Supabase separado por contexto. DECOR-17 añadirá después las capas Clean Architecture; esta tarea debe dejar una fundación pequeña que no anticipe esa estructura.

## Goals / Non-Goals

**Goals:**

- Mantener una sola aplicación Next.js en la raíz sin alterar documentación u OpenSpec.
- Hacer ejecutables los gates `test`, `lint`, `typecheck` y `build`.
- Convertir la ausencia de secretos en el cliente en una comprobación automatizada.
- Mantener las fábricas Supabase pequeñas y separadas por frontera de ejecución.

**Non-Goals:**

- Definir módulos, entidades, casos de uso o adaptadores de negocio.
- Implementar autenticación, middleware de refresco, CRUD o migraciones.
- Añadir Docker, Cloudinary SDK o `<model-viewer>`.

## Decisions

### Next.js 16 con configuración explícita

Se usará la versión estable disponible al inicializar, App Router, directorio `src`, alias `@/*` y TypeScript `strict`. ESLint se ejecutará directamente mediante flat config porque Next.js 16 ya no ofrece `next lint`. Se evita Tailwind: la portada requiere poco CSS y una dependencia adicional no aporta valor.

Alternativa descartada: aceptar todos los defaults interactivos de `create-next-app`; introduciría Tailwind y decisiones implícitas innecesarias.

### Tres fábricas Supabase

- `browser.ts` usa `createBrowserClient` con variables `NEXT_PUBLIC_*`.
- `server.ts` usa `createServerClient`, `cookies()` y la clave pública.
- `admin.ts` importa `server-only` y usa `createClient` con `SUPABASE_SERVICE_ROLE_KEY`, sin persistencia ni refresco de sesión.

Las variables se leen dentro de las fábricas, no al importar el módulo. Así lint, typecheck y pruebas que no crean clientes no requieren credenciales reales.

Alternativa descartada: una fábrica parametrizada universal; reduce archivos pero difumina la frontera de privilegios y facilita usar service role por error.

### Clave publicable moderna

El contrato usa `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No se añade fallback automático a anon key: no existe consumidor legado y dos nombres para el mismo dato complicarían validación y despliegue.

### Pruebas separadas por coste

Vitest con jsdom comprobará la portada. Playwright incluirá un único proyecto móvil Chromium y levantará `npm run dev`; su smoke test será ejecutable mediante `test:e2e`, pero `npm test` seguirá siendo rápido y no descargará navegadores.

### Escaneo de secretos por valores centinela

Un script Node de stdlib recorrerá `.next/static` después del build y fallará si encuentra los valores de `SUPABASE_SERVICE_ROLE_KEY` o `CLOUDINARY_URL`. El gate evitará falsos positivos por nombres legítimos de variables y comprobará lo realmente servido al navegador.

## Risks / Trade-offs

- [El cliente server no puede escribir cookies desde todos los contextos de render] -> Atrapar únicamente el error de escritura esperado; el futuro middleware de Auth asumirá el refresco de sesión.
- [Playwright requiere instalar Chromium aparte] -> Mantenerlo fuera de `npm test` y documentar el comando de instalación mediante el propio error de Playwright.
- [El escaneo cubre artefactos estáticos, no respuestas dinámicas futuras] -> Mantener `server-only` y añadir pruebas de rutas cuando existan endpoints.
- [Next.js puede ajustar `tsconfig.json` durante el primer build] -> Ejecutar build antes de revisar y versionar la configuración resultante.

## Migration Plan

1. Crear la aplicación y lockfile sobre la rama dedicada.
2. Añadir configuración, clientes y pruebas.
3. Ejecutar todos los gates con secretos centinela.
4. Si falla la adopción, revertir la rama completa; todavía no existen datos ni consumidores que migrar.
