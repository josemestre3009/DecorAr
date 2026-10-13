# DecorAR

Aplicacion web movil para configurar paquetes de decoracion, calcular su presupuesto y visualizar modulos 3D/AR. El sistema es un monolito modular construido con Next.js, React y TypeScript; usa Supabase y Cloudinary alojados.

## Ejecucion recomendada: Docker

Requisitos: Docker con Compose y acceso a un proyecto Supabase alojado. No se necesita PostgreSQL, Supabase CLI ni un stack Supabase local.

1. Crear un proyecto en [Supabase](https://supabase.com/dashboard) y copiar URL, publishable key y service role key desde el Dashboard.
2. Ejecutar en orden los archivos aprobados de `supabase/migrations` mediante el SQL Editor del Dashboard.
3. Crear una cuenta de Cloudinary y obtener `CLOUDINARY_URL` desde su Dashboard.
4. Copiar `.env.example` a `.env` y completar las variables. Mantener `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDINARY_URL` y `DECOR_RECOVERY_SECRET` solo en servidor.
5. Construir e iniciar la aplicacion:

```sh
docker compose up --build
```

Abrir `http://localhost:3000`. Compose levanta un solo servicio, `app`; Supabase y Cloudinary permanecen alojados fuera de Docker.

```sh
docker compose config --services
docker compose logs --follow app
docker compose down
```

El primer comando debe imprimir solamente `app`. El estado del contenedor y el endpoint de salud se consultan con:

```sh
docker compose ps
curl http://localhost:3000/api/health
```

Para reconstruir sin cache:

```sh
docker compose build --no-cache
docker compose up
```

Las variables `NEXT_PUBLIC_*` se incorporan al bundle durante el build. Reconstruir la imagen al modificarlas. `NEXT_PUBLIC_DECOR_PACKAGES_API=simulated` usa datos simulados; `live` activa la API persistida.

Mas opciones de puertos y operacion: [`docs/docker.md`](docs/docker.md).

## Ejecucion opcional con Node.js

Requisitos: Node.js 22 o superior, npm y los mismos servicios alojados.

```sh
npm ci
npm run dev
```

Produccion local:

```sh
npm run build
npm start
```

## Variables

| Variable | Uso | Exposicion |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Publica, build-time |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Cliente Auth/Realtime con RLS | Publica, build-time |
| `NEXT_PUBLIC_DECOR_PACKAGES_API` | `simulated` o `live` | Publica, build-time |
| `SUPABASE_SERVICE_ROLE_KEY` | Operaciones administrativas | Secreto server-side |
| `CLOUDINARY_URL` | Publicacion de GLB, USDZ y posters | Secreto server-side |
| `DECOR_RECOVERY_SECRET` | Bearer de `/api/internal/recovery` | Secreto server-side |
| `DECOR_E2E_*` | Pruebas E2E generales | Solo pruebas |
| `DECOR_E2E_USER_A_*`, `DECOR_E2E_USER_B_*` | Flujo E2E movil multiusuario | Solo pruebas |

La lista completa y copiable esta en [`.env.example`](.env.example). Nunca versionar `.env`.

## Arquitectura

Los diagramas C4 finales separan niveles y reflejan el despliegue real:

- [Nivel 1: contexto](docs/c4/context.md)
- [Nivel 2: contenedores](docs/c4/containers.md)
- [Nivel 3: componentes](docs/c4/components.md)

DecorAR es un monolito modular: todos los modulos se construyen y despliegan juntos en el contenedor Next.js. Supabase aporta PostgreSQL, PostgREST, Auth y Realtime; Cloudinary aloja activos 3D.

### Clean Architecture

| Ruta | Responsabilidad | Dependencias permitidas |
|---|---|---|
| `src/app` | UI, Server Components y Route Handlers | Interfaces, composition root y tipos de aplicacion/dominio; nunca infraestructura concreta |
| `src/interfaces` | Controladores y adaptadores de entrada | Aplicacion y dominio |
| `src/modules/*/application` | Casos de uso y puertos | Dominio y contratos compartidos |
| `src/modules/*/domain` | Entidades y reglas de negocio | TypeScript y dominio compartido |
| `src/modules/*/infrastructure` | Persistencia, eventos y proveedores | Puertos de aplicacion y plataforma |
| `src/infrastructure` | Clientes Supabase y logging | Configuracion, sin reglas de negocio |
| `src/composition` | Inyeccion server-side de adaptadores | Infraestructura concreta |
| `src/shared` | Resultados, errores y contratos transversales | Sin framework de UI |
| `src/lib` | Configuracion neutral | Sin reglas de negocio |
| `src/proxy.ts` | Limite de autenticacion de Next.js | Cliente Supabase server-side |

Las reglas se validan mediante `scripts/scan-architecture.test.ts`; el detalle esta en [`docs/architecture.md`](docs/architecture.md).

### Modulos y patrones

| Patron | Problema resuelto | Evidencia principal |
|---|---|---|
| Builder | Construccion valida de paquetes | `src/modules/packages/domain/decoration-package-builder-impl.ts` |
| Prototype | Clonacion profunda de configuraciones de evento | `src/modules/packages/domain/event-configuration.ts` y su prueba de dominio |
| Composite | Elementos y grupos tratados uniformemente | `src/modules/packages/domain/composite-module.ts`, endpoint `/groups` |
| Bridge | Elementos AR desacoplados del renderizador | `src/modules/ar/domain/elemento-ar.ts`, `renderizador-ar.ts` |
| Flyweight | Reutilizacion de activos 3D pesados | `src/modules/ar/domain/fabrica-activos-3d.ts` |
| Publish-Subscribe | Presupuesto desacoplado de cambios del paquete | `src/modules/events`, outbox y Realtime privado |
| Transactional Outbox | Publicacion posterior sin perder cambios confirmados | `private.domain_events`, `DrainOutboxUseCase` |
| Consumidor idempotente | Reintentos sin duplicar efectos | `ConsumePackageChangedEvent` y `process_budget_event` |

## API y errores

Los Route Handlers viven en `src/app/api`; los controladores en `src/interfaces`. Flujos principales:

- `/api/health`: salud del proceso.
- `/api/session`: estado de la sesion.
- `/api/modules`: catalogo activo.
- `/api/packages`: crear y listar paquetes propios.
- `/api/packages/{id}/items`, `/items/{itemId}`, `/groups`, `/clone`, `/budget`: configuracion, eliminacion, clonacion persistida y presupuesto.
- `/api/internal/recovery`: consulta, reintento y reconciliacion protegidos por Bearer.

Las respuestas fallidas usan codigos controlados como `auth.unauthenticated`, `package.not_found`, `package.version_conflict` e `internal_error`, mas `x-correlation-id`. `src/infrastructure/logging/json-logger.ts` genera logs JSON y `src/shared/application/sanitize-log-context.ts` censura secretos. La recuperacion usa outbox durable, reintentos e idempotencia; Realtime solo notifica y el cliente resincroniza desde PostgreSQL.

## Decisiones y trade-offs

- Monolito modular: despliegue simple y transacciones locales; escalado independiente de modulos no disponible.
- Supabase alojado: evita operar base de datos y autenticacion; requiere conectividad y depende del proveedor.
- Cloudinary alojado: optimiza distribucion de activos; la publicacion requiere credenciales server-side y red.
- PostgreSQL es la fuente de verdad. Realtime reduce latencia, pero no es durable.
- Consistencia eventual en presupuesto: desacopla paquetes y calculo; la UI puede mostrar brevemente un valor anterior.
- RLS protege datos por usuario. La service role queda limitada a adaptadores server-only.
- Docker contiene solo Next.js. Menos infraestructura local; las pruebas integrales necesitan servicios remotos configurados.

Analisis ampliado: [`docs/DecorAR.md`](docs/DecorAR.md).

## Verificacion

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

El E2E movil del MVP usa la API `live`, Docker, dos cuentas dedicadas y un seed previo:

```sh
npm run e2e:seed
npm run test:e2e:mvp
```

## Troubleshooting

| Problema | Accion |
|---|---|
| Cambio `NEXT_PUBLIC_*` no visible | Ejecutar `docker compose up --build` |
| Puerto 3000 ocupado | Definir `APP_PORT`, como documenta `docs/docker.md` |
| Contenedor no saludable | Revisar `docker compose logs app` y `/api/health` |
| Respuesta 401 | Verificar sesion y configuracion de Auth/RLS |
| Recovery responde 503 | Configurar `DECOR_RECOVERY_SECRET` |
| Datos simulados inesperados | Fijar `NEXT_PUBLIC_DECOR_PACKAGES_API=live` y reconstruir |
| Activo AR ausente | Verificar URLs publicadas en catalogo y `CLOUDINARY_URL` para republicar |

## Documentacion

- [`docs/architecture.md`](docs/architecture.md): capas y restricciones de imports.
- [`docs/docker.md`](docs/docker.md): operacion del contenedor.
- [`docs/assets-3d.md`](docs/assets-3d.md): preparacion y publicacion de activos.
- [`docs/DecorAR.md`](docs/DecorAR.md): decisiones arquitectonicas completas.
- [`docs/Actividad.md`](docs/Actividad.md): requisitos academicos 8.14-8.19.
