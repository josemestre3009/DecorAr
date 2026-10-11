# Packages

- `domain`: paquete, elementos y reglas de capacidad.
- `application`: construcción y modificación mediante puertos.
- `infrastructure`: persistencia server-side.

DECOR-27 añadirá los primeros contratos funcionales. Este módulo publica eventos; nunca importa `budget`.

Autorización: DECOR-30 entrega `checkPackageAccess(authorizePackageAccess, packageId)` (`src/interfaces/packages/package-access.ts`, composición `createPackageAccessDependencies()`). Cada Route Handler que añada DECOR-27 deberá llamarlo antes del caso de uso y devolver su `response` si el acceso se deniega. La propiedad se compara en `application/authorize-package-access.use-case.ts` y no depende de RLS.

Las tablas `public.packages` y `public.package_items` (DECOR-32) son mínimas y DECOR-27 las amplía. Toda escritura pasa por `PackageChangeOutbox.commit` (`src/modules/events/application/outbox.ts`), que guarda el cambio y su evento en una sola transacción; no se encadenan peticiones.

Composite (DECOR-25): `domain/decorative-component.ts` define `ComponenteDecorativo`; `ElementoDecorativo` es la hoja y `ModuloCompuesto` el grupo (máximo tres niveles, sin ciclos). `PaqueteDecoracion` y el Builder guardan y validan `ComponenteDecorativo`, así que una hoja y un grupo como "Zona de bienvenida" (`domain/welcome-zone.ts`) se tratan igual. Los grupos se guardan en `public.package_groups` con las RPC atómicas `create_package_group` y `add_package_item_to_group`, que reutilizan `commit_package_change`: cada hoja emite `package.module.added` y un grupo vacío no emite eventos.
