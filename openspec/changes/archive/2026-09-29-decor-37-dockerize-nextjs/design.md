# Design

## Context

DecorAR usa Next.js 16, Node.js 22 o superior y un script de build que ejecuta `next build` seguido de un escaneo de secretos del bundle cliente. Supabase y Cloudinary ya se configuran mediante variables de entorno y permanecen fuera del proceso Next.js. Véase `proposal.md` para la motivación y el spec para el contrato observable.

## Goals / Non-Goals

**Goals:**

- Reutilizar el output tracing de Next.js para limitar el runtime a archivos necesarios.
- Mantener secretos disponibles sólo durante runtime y fuera de capas de imagen.
- Proporcionar verificaciones reproducibles para servicio único, salud, usuario efectivo y contenido de imagen.

**Non-Goals:**

- Ejecutar Supabase, PostgreSQL, PostgREST, GoTrue, Realtime o Cloudinary localmente.
- Añadir proxy, TLS, orquestador, registro de imágenes o pipeline de despliegue.
- Comprobar proveedores externos desde el healthcheck o implementar Auth, DB y Realtime funcionales pertenecientes a otras tareas.

## Decisions

### Salida standalone de Next.js

`next.config.ts` habilita `output: "standalone"`. El runner copia `.next/standalone`, `.next/static` y `public`; ejecuta el `server.js` generado. Esto conserva el servidor de Next.js y evita instalar dependencias en la etapa final.

Alternativa descartada: ejecutar `npm start` con todo `node_modules`. Aumenta superficie e imagen sin aportar comportamiento.

### Imagen multi-stage sobre Node 22 Alpine

Una etapa de dependencias ejecuta `npm ci`; una etapa builder reutiliza esas dependencias y ejecuta el gate de build existente; una etapa runner copia únicamente artefactos. El usuario `node` de la imagen base ejecuta el proceso y recibe ownership de los archivos copiados.

Alternativa descartada: imagen distroless. Complica el healthcheck y la inspección académica sin una necesidad operativa actual.

### Variables públicas durante build, secretos durante runtime

Next.js necesita valores `NEXT_PUBLIC_*` durante el build porque los incrusta estáticamente. Se suministran como argumentos de build no secretos desde Compose. `SUPABASE_SERVICE_ROLE_KEY` y `CLOUDINARY_URL` no se declaran como argumentos ni variables de build; sólo entran mediante `env_file` al crear el contenedor. Los sentinels internos del script de build permiten compilar sin persistir secretos reales.

Alternativa descartada: copiar `.env` al builder. Puede persistir credenciales en capas o contexto y viola el contrato de seguridad.

### Healthcheck local sin proveedor externo

`GET /api/health` devuelve un JSON constante. Compose usa Node, ya presente en la imagen, para solicitar el endpoint. La salud del proceso no depende de red externa, credenciales ni disponibilidad de Supabase o Cloudinary.

Alternativa descartada: consultar proveedores en cada healthcheck. Mezcla readiness local con estado externo, consume red y puede revelar detalles operativos.

### Documentación aislada

Los comandos viven en `docs/docker.md`. DECOR-18 es dueño del README técnico final y podrá enlazar esta guía sin que DECOR-37 modifique ese entregable anticipadamente.

## Risks / Trade-offs

- [Los valores `NEXT_PUBLIC_*` quedan incorporados al bundle durante build] -> Tratarlos como configuración pública y pasarlos explícitamente; nunca usar esta vía para service role o Cloudinary.
- [Alpine puede exigir librerías nativas para dependencias futuras] -> Mantener la imagen mínima actual y cambiar de variante sólo cuando una dependencia real lo requiera.
- [El healthcheck no prueba Supabase ni Cloudinary] -> Conservarlo determinista; probar integraciones en sus tareas funcionales y gates específicos.
- [Inspeccionar texto en capas no demuestra ausencia criptográfica de secretos desconocidos] -> Usar valores canario en la validación y excluir todo `.env*` salvo el ejemplo.

## Migration Plan

1. Habilitar la salida standalone sin cambiar rutas ni APIs existentes.
2. Añadir endpoint de salud y verificarlo fuera de Docker.
3. Construir la imagen, iniciar Compose y comprobar servicio, usuario, UI y salud.
4. Inspeccionar imagen y configuración con valores canario antes de publicar la rama.
5. Revertir los archivos de esta rama para volver a la ejecución Node existente; no hay datos ni infraestructura que migrar.
