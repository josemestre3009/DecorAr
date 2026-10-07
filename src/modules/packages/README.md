# Packages

- `domain`: paquete, elementos y reglas de capacidad.
- `application`: construcción y modificación mediante puertos.
- `infrastructure`: persistencia server-side.

DECOR-27 añadirá los primeros contratos funcionales. Este módulo publica eventos; nunca importa `budget`.

Las tablas `public.packages` y `public.package_items` (DECOR-32) son mínimas y DECOR-27 las amplía. Toda escritura pasa por `PackageChangeOutbox.commit` (`src/modules/events/application/outbox.ts`), que guarda el cambio y su evento en una sola transacción; no se encadenan peticiones.
