# Tasks

## 1. Runtime Next.js

- [x] 1.1 Habilitar la salida standalone en Next.js; verificar que `npm run build` genera `.next/standalone/server.js`
- [x] 1.2 Implementar `GET /api/health` con respuesta constante no sensible y su prueba unitaria; verificar con `npm test`

## 2. Contenedor de aplicación

- [x] 2.1 Crear un Dockerfile multi-stage con Node 22, instalación reproducible, artefactos standalone y usuario no root; verificar con `docker compose build`
- [x] 2.2 Crear `.dockerignore` para dependencias, outputs, Git, cobertura y secretos; verificar que el contexto conserva `.env.example` y excluye `.env`
- [x] 2.3 Crear `compose.yaml` con sólo `app`, puerto 3000, `env_file` y healthcheck local; verificar con `docker compose config --services`
- [x] 2.4 Documentar build, up, logs, down y rebuild en `docs/docker.md`; verificar los comandos contra el Compose creado

## 3. Verificación integrada

- [x] 3.1 Ejecutar `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` y `npm run test:e2e`; corregir divergencias
- [x] 3.2 Iniciar Compose con configuración de prueba y verificar UI, `GET /api/health`, estado healthy y ejecución no root
- [x] 3.3 Inspeccionar la imagen con valores canario y verificar ausencia de `.env`, service role y secreto Cloudinary, además de confirmar que no existen servicios auxiliares
- [x] 3.4 Ejecutar `openspec validate decor-37-dockerize-nextjs --type change --strict` y `openspec validate --all --strict`; corregir todos los hallazgos
