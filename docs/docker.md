# Docker

Docker ejecuta únicamente la aplicación Next.js. Supabase PostgreSQL, PostgREST, Auth y Realtime, junto con Cloudinary, permanecen alojados fuera de Compose.

## Configuración

Crear `.env` desde `.env.example` y completar las credenciales de los servicios alojados. `.env` se entrega al contenedor durante el arranque y no forma parte de la imagen. Las variables `NEXT_PUBLIC_*` también se incorporan al bundle durante el build porque son configuración pública del navegador; nunca usar ese prefijo para secretos. Reconstruir la imagen después de cambiar cualquier variable `NEXT_PUBLIC_*`.

## Operación

Construir e iniciar DecorAR:

```sh
docker compose up --build
```

Consultar logs:

```sh
docker compose logs --follow app
```

Detener y eliminar el contenedor:

```sh
docker compose down
```

Reconstruir sin reutilizar caché:

```sh
docker compose build --no-cache
docker compose up
```

La interfaz queda disponible en `http://localhost:3000`. La salud del proceso se consulta en `http://localhost:3000/api/health`.

Si el puerto 3000 del equipo está ocupado, seleccionar otro puerto sin cambiar el contenedor:

```sh
APP_PORT=3001 docker compose up
```

## Verificación

Confirmar que Compose define sólo la aplicación:

```sh
docker compose config --services
```

El resultado esperado es únicamente `app`. Ningún integrante necesita instalar Supabase CLI, PostgreSQL, PostgREST, GoTrue, Realtime ni Cloudinary localmente.
