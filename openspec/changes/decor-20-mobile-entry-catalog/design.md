# Design

## Context

DECOR-38 dejó la sesión SSR, el proxy que protege toda página no pública y la regla de que cada página de `(protected)/` llama a `await requireSessionUser()` (`src/app/route-inventory.test.ts`). DECOR-28 dejó `GET /api/modules`, que responde un arreglo de `CatalogModuleDto` y, ante un fallo, `{error:"Internal Server Error", correlationId}`. El seed deja los módulos en `draft`, de modo que hoy la API real devuelve `[]`; el fixture `public/fixtures/catalog-modules.json` tiene la misma forma que la respuesta.

DECOR-27 es dueño del contrato de paquetes:

- `POST /api/packages {spaceType, capacityM2}` → 201 `{id, spaceType, capacityM2}`
- `POST /api/packages/{id}/items {moduleId, parentGroupId?}` → 201 `{itemId, packageVersion}`
- errores `{error:{code,message}}` con 400/404/422

Ninguno de esos endpoints existe todavía en ninguna rama.

## Goals / Non-Goals

**Goals:**

- Portada con llamada a la acción hacia la pantalla del paquete.
- Formulario accesible de tipo de espacio y `capacityM2` positiva y finita.
- Crear el paquete y navegar a su catálogo.
- Consumir `GET /api/modules` desde el navegador, sin `.from()` de negocio.
- Tarjeta con poster, precio COP, área y "Agregar".
- Estados de carga, vacío, error y reintento, accesibles y sin desbordamiento a 360 px.

**Non-Goals:**

- Implementar `POST /api/packages` o `/items`, el Builder o la persistencia (corresponde a DECOR-27).
- Activar módulos del catálogo (corresponde a DECOR-36).
- Editar el paquete, agrupar módulos o mostrar el presupuesto (corresponde a DECOR-22 y DECOR-36).
- Búsqueda, filtros y paginación del catálogo.

## Decisions

### Componentes cliente que hablan HTTP con un puerto de paquetes intercambiable

La interfaz es cliente: el catálogo se pide con `fetch("/api/modules")` y el paquete se crea a través de `PackagesClient`, un puerto con dos implementaciones. `createHttpPackagesClient` habla con los Route Handlers de DECOR-27; `createSimulatedPackagesClient` responde con la misma forma y los mismos códigos sin red, guardando en `sessionStorage`. `NEXT_PUBLIC_DECOR_PACKAGES_API` elige la implementación, y la HTTP ya está probada contra el contrato, así que integrar DECOR-27 es cambiar la variable.

*Alternativa descartada:* crear Route Handlers temporales en `src/app/api/packages/`. Invade la propiedad de DECOR-27, provoca conflictos sobre los mismos archivos y deja una API falsa que podría fusionarse en `main`.

*Alternativa descartada:* Server Actions que llamen a los casos de uso. No consume `GET /api/modules` ni crea el paquete vía Route Handler, como pide la tarea, y obliga a rehacer el flujo al integrar DECOR-27.

### Las utilidades viven en `src/app/(protected)/packages/_lib/`

El escáner de arquitectura no permite que un archivo `"use client"` importe infraestructura ni la composición, y la persistencia de paquetes pertenece a `src/modules/packages` (DECOR-27). Las utilidades son de presentación y van junto a las páginas que las usan, en una carpeta privada que Next no expone como ruta. Del dominio solo se importa `Result` de `src/shared/domain` y el tipo `CatalogModuleDto` con `import type`.

### Validación en el cliente como experiencia de usuario

`validateSpaceDefinition` evita peticiones que el servidor rechazaría y acepta la coma decimal. No sustituye la validación del Builder de DECOR-27, que vuelve a validar en el servidor. Los valores de tipo de espacio son los canónicos de `docs/DecorAR.md`: `casa`, `aireLibre`, `salonSocial`.

### Lectura de errores tolerante

`readApiError` acepta `{error:{code,message}}` y el formato actual de `/api/modules`. Solo muestra el mensaje del servidor en 4xx; en 5xx usa un texto genérico. Un 401 envía al login.

### `<img>` en lugar de `next/image`

Los posters llegan de dominios que aún no están decididos (fixture en `example.com`, Cloudinary en DECOR-36). `next/image` exige autorizarlos en `next.config.ts`. Se usa `<img>` con proporción fija por CSS, carga diferida y un marcador cuando `posterUrl` es `null` o la imagen falla.

## Risks / Trade-offs

- [DECOR-27 cambia el contrato] -> Las pruebas del cliente HTTP fijan rutas, cuerpos y respuestas; cualquier cambio las rompe y obliga a revisar.
- [DECOR-27 no acepta `casa`, `aireLibre`, `salonSocial`] -> Coordinar con Rafael antes de pasar a `live`.
- [En modo simulado el paquete no existe en el servidor] -> Aviso visible "Modo simulado"; vive en `sessionStorage` y la capacidad no se compara con el área de los módulos.
- [`GET /api/modules` responde `[]` mientras el seed siga en `draft`] -> El estado vacío es el comportamiento correcto; las tarjetas se prueban con el fixture vía `page.route`.
- [`GET /api/modules` no exige sesión y usa caché pública] -> No se modifica (DECOR-28); se reporta para decisión de Jose.
- [La caché pública de 60 s haría que "Volver a consultar" reutilizara `[]`] -> Hallazgo F1 de Jose: `catalog-client.ts` pide con `cache: "no-store"`, de modo que cada carga y cada reintento consultan al servidor.
- [`NEXT_PUBLIC_*` se fija al compilar] -> Reconstruir la imagen al pasar a `live`.

## Migration Plan

1. Integrar DECOR-27 en `main`.
2. Confirmar los valores de `spaceType` y el envelope de errores.
3. Construir con `NEXT_PUBLIC_DECOR_PACKAGES_API=live` y repetir la E2E autenticada.
4. Retirar `createSimulatedPackagesClient` cuando ya no se necesite para desarrollo.
