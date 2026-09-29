# Proposal

## Why

DecorAR todavía no tiene una aplicación ejecutable, comandos de calidad ni una frontera segura entre credenciales públicas y privadas. Esta fundación desbloquea las tareas posteriores sin introducir prematuramente dominio, autenticación o infraestructura de despliegue.

## What Changes

- Inicializar una aplicación Next.js estable con App Router y TypeScript estricto.
- Añadir comandos reproducibles de desarrollo, build, lint, typecheck, pruebas unitarias y pruebas E2E.
- Configurar Vitest y una base móvil de Playwright con una prueba mínima de la portada.
- Añadir clientes Supabase separados para navegador, servidor con sesión y administración privilegiada.
- Añadir un contrato de variables de entorno sin secretos reales y una comprobación del bundle cliente.
- Mostrar una portada mínima que identifique DecorAR y su propósito.

## Capabilities

### New Capabilities

- `application-foundation`: Aplicación Next.js ejecutable, portada y comandos base verificables.
- `supabase-client-boundaries`: Separación observable entre clientes Supabase públicos, de sesión server-side y administrativos.

### Modified Capabilities

Ninguna.

## Impact

- Crea la base de código Next.js, configuración TypeScript/ESLint, pruebas y lockfile.
- Añade dependencias de Next.js, React, Supabase, Vitest, Testing Library y Playwright.
- Define variables públicas Supabase y variables privadas para Supabase admin y Cloudinary.
- No añade autenticación funcional, migraciones SQL, módulos de dominio, Docker, README final ni pantallas de negocio.
