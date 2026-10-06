# Tasks

## 1. Utilidades de interfaz

- [x] 1.1 `_lib/space-definition.ts`: tipos de espacio canónicos y validación estrictamente numérica de `capacityM2` (dígitos con decimal opcional por punto o coma), con un mensaje distinto para vacío, solo letras, números mezclados con otros caracteres, valores no mayores que 0 y números no finitos; verificar con `space-definition.test.ts`
- [x] 1.2 `_lib/format.ts`: precio COP sin decimales y área en m²; verificar con `format.test.ts`
- [x] 1.3 `_lib/api-error.ts`: lectura del envelope `{error:{code,message}}` y del formato actual de `/api/modules`, sin mostrar detalles de un 5xx; verificar con `api-error.test.ts`
- [x] 1.4 `_lib/catalog-client.ts`: `GET /api/modules` con validación de la forma de respuesta; verificar con `catalog-client.test.ts` contra el fixture de DECOR-28
- [x] 1.5 `_lib/packages-client.ts`: puerto `PackagesClient`, implementación HTTP con el contrato de DECOR-27 e implementación simulada; verificar con `packages-client.test.ts`

## 2. Pantallas

- [x] 2.1 Portada con "Crear mi paquete" hacia `/packages`; verificar con `src/app/page.test.tsx`
- [x] 2.2 `/packages` con `SpaceForm`, conservando el aviso de sesión y el cierre de sesión de DECOR-38; verificar con `space-form.test.tsx`
- [x] 2.3 `/packages/[packageId]` con `requireSessionUser()` y `PackageCatalog`; verificar con `route-inventory.test.ts`
- [x] 2.4 `PackageCatalog` y `ModuleCard` con carga, vacío, error, reintento y "Agregar"; verificar con `package-catalog.test.tsx`
- [x] 2.5 Estilos en `globals.css` con los tokens existentes, una columna a 360 px y foco visible
- [x] 2.6 Recorrido con teclado: E2E que recorre portada, `/packages` y `/packages/{id}` solo con Tab, flechas y Enter, comprobando el contorno de `:focus-visible` de cada control

## 3. Configuración y documentación

- [x] 3.1 `NEXT_PUBLIC_DECOR_PACKAGES_API` en `.env.example`, `Dockerfile` y `compose.yaml`
- [x] 3.2 `vitest.setup.ts` registra `cleanup` de Testing Library, necesario sin `globals: true`
- [x] 3.3 `docs/DecorAR.md` §2.2.3 con el recorrido, la simulación temporal y sus límites

## 4. Verificación

- [x] 4.1 `npm run typecheck` y `npm run lint` sin errores
- [x] 4.2 `npm test`: 30 archivos, 304 pruebas (antes 22 archivos y 181 pruebas en `main`)
- [x] 4.3 `npm run build`: exit 0, escaneo de secretos superado en 14 artefactos; `/packages` y `/packages/[packageId]` dinámicas
- [x] 4.4 `npm run test:e2e` sin credenciales: 16 pasan y 7 se omiten (3 de DECOR-38 y 4 de DECOR-20 que requieren sesión)
- [x] 4.5 `npm run test:e2e` con credenciales: 22 pasan y 1 se omite (el registro de DECOR-38, que consume la cuota de correo). Se usó una cuenta efímera creada con la admin API y `email_confirm: true`, eliminada al terminar
- [ ] 4.6 `openspec validate decor-20-mobile-entry-catalog --type change --strict` (el CLI no está instalado en esta máquina; formato revisado a mano)

### Desviaciones registradas durante la verificación E2E

- La E2E de teclado encontró dos fallos de accesibilidad, ya corregidos:
  - Al navegar del formulario al catálogo, el control con foco desaparecía y el siguiente Tab continuaba desde un punto intermedio de la página nueva. `PageHeading` (`[packageId]/page-heading.tsx`) mueve el foco al título "Tu paquete" al llegar.
  - "Agregar" usaba `disabled` mientras esperaba, y un botón deshabilitado pierde el foco. Ahora usa `aria-disabled` e ignora los clics repetidos; lo cubre `package-catalog.test.tsx`.

- `getByRole("alert")` también encuentra `#__next-route-announcer__`, que Next.js añade con `role="alert"`; los errores de la aplicación se buscan dentro de `<main>`.
- En desarrollo, StrictMode ejecuta dos veces el efecto que pide el catálogo y cancela la primera petición; la prueba de reintento no cuenta peticiones, sino que la API falla hasta pulsar "Reintentar".
- `fullyParallel: false` solo serializa dentro de un archivo. Con dos archivos autenticados, `auth.spec.ts` cerraba sesión en paralelo y Supabase revocaba la sesión de la misma cuenta en `mobile-entry-catalog.spec.ts`. `playwright.config.ts` fija ahora `workers: 1`.

## 5. Coordinación pendiente

- [ ] 5.1 Confirmar con DECOR-27 los valores de `spaceType` (`casa`, `aireLibre`, `salonSocial`)
- [ ] 5.2 Informar a Jose del formato de error y de la ausencia de sesión en `GET /api/modules`
- [ ] 5.3 Archivar el cambio tras la fusión
