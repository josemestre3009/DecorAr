# Proposal

## Why

DecorAR necesita una ejecución reproducible con Docker sin convertir los servicios alojados en infraestructura local. La entrega debe aislar únicamente el monolito Next.js y preservar Supabase y Cloudinary como dependencias remotas.

## What Changes

- Configurar la aplicación Next.js para producir una salida standalone.
- Añadir una imagen multi-stage que ejecute la aplicación como usuario no root y contenga sólo los artefactos necesarios en runtime.
- Añadir un Compose con un único servicio `app`, puerto 3000 y variables tomadas de `.env`.
- Añadir `GET /api/health` para comprobar el proceso sin consultar servicios externos ni exponer configuración sensible.
- Excluir dependencias locales, resultados de build, metadatos Git, cobertura y secretos del contexto Docker.
- Documentar build, inicio, logs, parada y reconstrucción del contenedor.
- Verificar que la imagen no contiene secretos y que no se despliega Supabase, PostgreSQL, PostgREST, Auth, Realtime ni Cloudinary localmente.

## Capabilities

### New Capabilities

- `dockerized-nextjs-runtime`: Construcción y ejecución reproducible del monolito Next.js como único servicio Docker, con healthcheck, usuario no root y servicios externos alojados.

### Modified Capabilities

Ninguna.

## Impact

- Modifica la configuración de Next.js y añade artefactos Docker en la raíz del repositorio.
- Añade un Route Handler de salud bajo `src/app/api/health` y su prueba.
- Añade documentación operativa específica de Docker.
- No añade dependencias npm, contenedores auxiliares, migraciones, datos ni cambios en APIs de negocio.
