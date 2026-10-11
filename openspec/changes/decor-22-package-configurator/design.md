# Design

## Context

DECOR-27 expone `POST /items` y `DELETE /items/{itemId}`, DECOR-24 `POST /clone`, DECOR-25 `POST /groups` y el árbol Composite, y DECOR-33 `GetBudgetUseCase` (`GET /budget`). No existía ninguna lectura del detalle del paquete: `PackageReader` devuelve ítems sin nombre, precio ni grupo, y `loadPackageTree` usa `precio: 0`.

## Goals / Non-Goals

**Goals:**

- Mostrar tipo descriptivo, capacidad, área usada y restante, sin capacidades fijas en la interfaz.
- Listar hojas y grupos con cantidades y subtotales informativos; grupos expandibles con `aria-expanded`.
- Agregar, quitar y duplicar con la API real, refrescando desde el servidor; un 422 no muta la interfaz.
- Mostrar el total confirmado de Presupuesto.

**Non-Goals:**

- Editar el tipo o la capacidad del espacio (el paquete conserva la capacidad con la que se creó).
- Presupuesto en tiempo real, resincronización por reconexión o `visibilitychange` (DECOR-21).
- Un endpoint público `GET /api/packages/{id}`.

## Decisions

### Lectura en el Server Component vía composición

`page.tsx` llama a `createPackageQueryDependencies()`: `authorizePackageAccess` (cliente de sesión), `getPackageDetail` (service_role tras autorizar y filtrando por dueño) y `getBudget` (cliente de sesión, RLS). Después de cada mutación, los componentes cliente hacen `router.refresh()` y la lectura se repite. El recálculo del presupuesto se espera antes de que el POST o DELETE respondan, así que el refresco ya trae el total nuevo.

Alternativa descartada: `GET /api/packages/{id}` consumido por el cliente. Añade un contrato que nadie definió, un estado de carga inicial y dos viajes por refresco. Si DECOR-21 o DECOR-39 lo necesitan, puede exponerse reutilizando el mismo caso de uso.

### Presupuesto se combina en la composición

`packages` no puede importar `budget` (`packages-budget-coupling`). La página recibe el detalle y el total por separado. Un 404 `budget.not_found` (paquete sin mutaciones o recién clonado) se muestra como "aún no calculado"; otros errores, como error con reintento. La interfaz nunca suma un total.

### Árbol Composite con precios reales

`GetPackageDetailUseCase` reutiliza `reconstruirComponentes` (DECOR-25) con los precios del catálogo y no usa `PaqueteDecoracion.create`, para que un paquete ya guardado se muestre aunque estuviera por encima de la capacidad. El DTO `PackageDetailView` es plano y serializable.

### Cantidades al pintar

Cada unidad es una fila de `package_items`. La interfaz agrupa las hojas del mismo módulo en cada nivel ("Mesa redonda ×2"); "Quitar uno" borra un `itemId` de esa fila.

### Modo simulado

El paquete simulado vive en el navegador, así que el servidor no puede leerlo. En modo simulado la página sigue como en DECOR-20 y muestra un aviso; la E2E de DECOR-20 no cambia.

## Risks / Trade-offs

- [`router.refresh()` vuelve a renderizar la página completa] -> La página es pequeña y la lectura son tres consultas.
- [El catálogo y la Zona de bienvenida conservan sus mensajes locales en modo simulado] -> En `live` el contenido del servidor es la fuente de verdad.

## Migration Plan

Sin migraciones. La E2E en vivo requiere la migración de Presupuesto `20261008010000_create_idempotent_budget_consumer.sql` aplicada en el alojado (verificada el 2026-10-11).
