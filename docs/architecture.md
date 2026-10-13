# Arquitectura del código

DecorAR es un monolito modular Next.js. Los módulos se despliegan juntos, pero sus dependencias respetan Clean Architecture.

```mermaid
flowchart LR
    app["src/app<br/>Next.js routes and UI"] --> interfaces["src/interfaces<br/>input adapters"]
    app --> composition["src/composition<br/>server-only wiring"]
    interfaces --> application["src/modules/*/application<br/>use cases and ports"]
    application --> domain["src/modules/*/domain<br/>business rules"]
    infrastructure["src/modules/*/infrastructure<br/>business adapters"] --> application
    infrastructure --> sharedInfrastructure["src/infrastructure<br/>Supabase platform clients"]
    composition --> infrastructure
    application --> shared["src/shared<br/>domain primitives and cross-cutting ports"]
    sharedInfrastructure --> config["src/lib<br/>framework-neutral configuration"]
```

## Ubicaciones

| Ruta | Responsabilidad |
|---|---|
| `src/app` | Páginas y Route Handlers exigidos por App Router. Los handlers adaptan HTTP; no implementan dominio ni persistencia. |
| `src/interfaces` | Controladores y adaptadores de entrada reutilizables invocados por Route Handlers. |
| `src/modules/*/domain` | Entidades y reglas sin React, Next.js, Supabase, Cloudinary ni capas externas. |
| `src/modules/*/application` | Casos de uso y puertos. Puede importar dominio; no adaptadores concretos. |
| `src/modules/*/infrastructure` | Implementaciones de puertos para persistencia, eventos o proveedores. |
| `src/infrastructure` | Clientes compartidos de plataforma. No contiene reglas de negocio. |
| `src/composition` | Construcción server-only de dependencias concretas. |
| `src/shared` | Primitivas de dominio y contratos transversales mínimos. |
| `src/lib` | Configuración neutral existente; no es una capa de negocio. |

## Reglas verificadas

| Regla | Permitido | Prohibido |
|---|---|---|
| `domain-external-framework` | TypeScript y dominio compartido | React, Next.js, Supabase, Cloudinary |
| `domain-internal-dependency` | Dominio del mismo módulo y `src/shared/domain` | Aplicación, infraestructura, interfaces, composition root |
| `application-internal-dependency` | Dominio y puertos | Infraestructura, interfaces, composition root |
| `interfaces-infrastructure-dependency` | Aplicación y dominio | Adaptadores concretos de infraestructura |
| `app-infrastructure-dependency` | Interfaces y composition root | Adaptadores concretos de infraestructura desde entradas server-side |
| `client-server-import` | UI y cliente Supabase browser | Adaptadores server/admin, `server-only`, composition root |
| `client-business-crud` | Auth y Realtime privados | `.from()` sobre catálogo, paquetes, elementos, presupuestos, eventos o plantillas |
| `packages-budget-coupling` | Eventos o puertos compartidos | Import directo desde packages hacia budget |

`scripts/scan-architecture.test.ts` valida el árbol real y casos negativos controlados. PostgREST es la Data API interna de Supabase, no un módulo ni despliegue separado.

DECOR-44 mantiene el mismo límite para las plantillas privadas de eventos. Los Route Handlers de `/api/event-templates` (y `PATCH /api/packages/{id}`) adaptan HTTP en `src/app/api`, delegan en `EventTemplateController`/`PackageController` en `src/interfaces`, validan sesión y propiedad con `checkEventTemplateAccess` o `checkPackageAccess`, y persisten mediante RPC `SECURITY INVOKER` de `service_role`. El navegador nunca escribe `event_templates`, `event_template_groups` ni `event_template_items`; RLS solo concede lectura al propietario.

El Composite editable (`editable-decorative-groups`) sigue el mismo límite: los Route Handlers `POST /api/packages/{id}/groups`, `PATCH|DELETE /api/packages/{id}/groups/{groupId}` y `PATCH /api/packages/{id}/items/{itemId}` adaptan HTTP en `src/app/api`, delegan en `PackageController` en `src/interfaces`, validan sesión y propiedad con `checkPackageAccess`, y persisten mediante las RPC `create_package_group`, `update_package_group`, `delete_package_group` y `move_package_item` (`SECURITY INVOKER`, `service_role`). El navegador no escribe `package_groups` ni `package_items`; no se añaden dependencias, tablas ni rutas paralelas.
