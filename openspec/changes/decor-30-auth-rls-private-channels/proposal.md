# Proposal

## Why

DECOR-38 dejó la sesión SSR y la validación de identidad, y DECOR-32 dejó `public.packages`, `public.package_items` y la outbox privada en modo deny-all. Falta decidir quién puede ver cada paquete: hoy no existe una comprobación de propiedad que los Route Handlers de DECOR-27 puedan reutilizar, PostgreSQL no tiene políticas por usuario y el canal Broadcast `package:{packageId}` no tiene autorización, así que cualquier usuario podría unirse a él o publicar un presupuesto falso.

## What Changes

- Añadir el caso de uso `AuthorizePackageAccessUseCase` y su adaptador HTTP `checkPackageAccess`. Validan sesión y propiedad antes de cualquier caso de uso de paquete y responden 401 o 404 sin depender de RLS.
- Añadir una migración con políticas RLS de solo lectura para el dueño sobre `packages` y `package_items`, permisos mínimos sobre el catálogo y su RPC de activación, y una política sobre `realtime.messages` que solo permite al dueño unirse al canal privado. No hay política de escritura, así que solo el backend publica.
- Añadir `subscribeToPackageChannel` en la fábrica del navegador, el único uso de Realtime en el cliente, sin `postgres_changes`.
- Añadir pruebas negativas para usuario A (dueño), usuario B (ajeno) y anónimo en Handler, RLS y Realtime, y una prueba de que la service role no se puede alcanzar desde el cliente.
- Añadir fixtures A/B opcionales contra el proyecto alojado.

## Capabilities

### New Capabilities

- `authorization-rls-private-channels`: autorización por propiedad en Route Handlers, RLS como defensa adicional y canales Broadcast privados por paquete.

### Modified Capabilities

Ninguna. `supabase-client-boundaries` ya exige que la service role no aparezca en el bundle; este cambio añade una prueba que lo refuerza sin modificar el requisito.

## Impact

- Una migración SQL aditiva y su prueba ejecutable con PGlite.
- Código nuevo en `src/modules/packages/application`, `src/interfaces/packages` y `src/infrastructure/supabase`, más la fábrica `createPackageAccessDependencies()` en la composición.
- Sin endpoints nuevos: DECOR-27 los crea usando `checkPackageAccess`. Sin UI de autenticación. PGlite se añade sólo como dependencia de desarrollo para ejecutar las políticas en `npm test`.
