# Tasks

## 1. Lectura del detalle

- [x] 1.1 Puerto `PackageDetailReader` y DTO `PackageDetailView`.
- [x] 1.2 `GetPackageDetailUseCase` con árbol Composite, precios reales y área usada/restante; verificar con `get-package-detail.use-case.test.ts`.
- [x] 1.3 Adaptador `SupabasePackageDetailReader` (server-only, filtra por dueño); verificar con su test.
- [x] 1.4 `createPackageQueryDependencies()` en la composición.

## 2. Configurador

- [x] 2.1 `page.tsx`: lectura en servidor en modo `live`, 404 para paquete ajeno, error con reintento y aviso en modo simulado.
- [x] 2.2 `SpaceSummary`, `BudgetTotal` y `PackageContents` (grupos con `aria-expanded`, quitar por unidad, subtotales informativos).
- [x] 2.3 `PackagesClient.removeItem` y `router.refresh()` tras agregar, quitar y crear la Zona de bienvenida.
- [x] 2.4 Estilos sin desborde a 360 px.

## 3. Verificación

- [x] 3.1 `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- [x] 3.2 E2E en vivo `e2e/package-configurator-live.spec.ts` (5/5) con video, contra el Supabase alojado.
- [x] 3.3 Ejecutar `openspec validate decor-22-package-configurator --type change --strict`: válido (`npx @fission-ai/openspec@1.14.1`, telemetría desactivada).
