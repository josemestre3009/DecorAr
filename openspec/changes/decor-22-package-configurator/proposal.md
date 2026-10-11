# Proposal

## Why

DECOR-22 pide que `/packages/{id}` sea un configurador: ver el espacio, lo que contiene el paquete y su total, agregar y quitar elementos, ver los grupos (Composite) y duplicar (Prototype), todo contra la API real. Hoy la página solo verifica la sesión y muestra el catálogo: no lee el paquete, no muestra el total, no permite quitar y no tiene una lectura de detalle en ninguna capa.

## What Changes

- Añadir el puerto `PackageDetailReader` y el caso de uso `GetPackageDetailUseCase` en `packages`, que reconstruye el árbol Composite guardado (DECOR-25) con los precios reales del catálogo y calcula el área usada y restante.
- Añadir el adaptador server-only `SupabasePackageDetailReader` y la fábrica `createPackageQueryDependencies()`, que combina autorización, detalle y presupuesto (`GetBudgetUseCase`) en la composición.
- Convertir `/packages/[packageId]` (modo `live`) en el configurador: resumen del espacio, total confirmado de Presupuesto, contenido con hojas agrupadas, subtotales informativos, grupos expandibles con `aria-expanded` y quitar por unidad. Un paquete ajeno o inexistente responde 404.
- Añadir `PackagesClient.removeItem` (`DELETE …/items/{itemId}` → 204) y refrescar la página con `router.refresh()` tras agregar, quitar o crear la Zona de bienvenida.
- Añadir la E2E opt-in `e2e/package-configurator-live.spec.ts` contra la API real, que graba video.

## Capabilities

### New Capabilities

- `package-configurator`: lectura del paquete en el servidor y configurador que hace observables Builder, Composite y Prototype.

### Modified Capabilities

Ninguna. No cambian los contratos de DECOR-24 (clone), DECOR-27 (items) ni DECOR-33 (budget); solo se consumen.

## Impact

- Código nuevo en `src/modules/packages/application`, `src/infrastructure/supabase`, `src/composition/server.ts` y `src/app/(protected)/packages`.
- Sin endpoints públicos nuevos ni migraciones.
- En modo simulado (DECOR-20) la página sigue como antes, con un aviso.
