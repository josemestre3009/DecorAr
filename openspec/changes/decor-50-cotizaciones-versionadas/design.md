# Design

## Context

Un evento es una fila de `public.packages`; sus elementos son filas de `package_items` (una por unidad, sin columna de cantidad) que referencian `catalog_modules`, donde viven nombre y `price_cop` (COP entero). `calculateBudget` suma precios en vivo. DECOR-44 estableció el patrón de instantánea: tablas propias, RLS de solo lectura para el dueño y RPC atómicas `SECURITY INVOKER` ejecutables solo por `service_role`. Las reglas de negocio viven en `src/modules/*/domain` y `scripts/scan-architecture.ts` vigila las capas.

## Goals / Non-Goals

**Goals:**

- Conservar valores históricos aunque cambien el evento o el catálogo, o se elimine el evento.
- Totales calculados en servidor, deterministas y verificables por pruebas de dominio.
- Versiones independientes bajo un mismo número.
- Autorización en profundidad: HTTP, RPC y RLS.

**Non-Goals:**

- Vista previa, PDF, enlace público o envío (DECOR-51 a DECOR-54).
- Vencimiento automático por fecha, edición manual de líneas, clientes como entidad propia o múltiples monedas.

## Decisions

### 1. Módulo `quotes` con cálculo en dominio y guardado por RPC

`calculateQuote` (dominio puro) calcula líneas y totales; el caso de uso lee la instantánea por un puerto propio (`QuoteSourceReader`), calcula y llama a una RPC que inserta cabecera y líneas en una transacción.

Alternativa descartada: calcular todo dentro de una función PL/pgSQL. Sacaría la regla comercial del dominio, dejaría sin pruebas de dominio la fórmula y obligaría a una migración por cada cambio de cálculo.

### 2. Fórmula y redondeo

Tasas en puntos básicos (0 a 10000). Subtotal = suma de cantidad × precio; descuento sobre el subtotal; impuesto sobre la base (subtotal − descuento); total = base + impuesto; anticipo sobre el total. Cada monto derivado se redondea al peso, con la mitad hacia arriba, usando BigInt para no perder precisión. El impuesto es obligatorio en la solicitud; descuento y anticipo valen 0 si se omiten. La vigencia se compara con la fecha de hoy en America/Bogota.

Alternativa descartada: porcentajes decimales en `number`. Introducen errores binarios de redondeo en montos de dinero.

### 3. La RPC verifica la instantánea

`private.insert_quote_version` bloquea el evento (`FOR SHARE`), exige la versión que leyó la aplicación (`quote.package_version_conflict`), compara módulos, nombres, cantidades y precios con `package_items` y `catalog_modules` (`quote.snapshot_mismatch`) y exige que el subtotal sea la suma de las líneas (`quote.invalid_totals`). Las CHECK mantienen `total = subtotal − descuento + impuesto` y `línea = cantidad × precio`.

### 4. Numeración y versiones

`private.quote_counters` asigna el siguiente número por dueño con un upsert que bloquea la fila; `create_quote_version` bloquea la misma fila y usa `MAX(version) + 1`. `UNIQUE (owner_id, quote_number, version)` impide duplicados. Si la creación falla, la transacción revierte el contador.

### 5. Inmutabilidad

Un disparador rechaza (`quote.immutable`) cualquier cambio en `quotes` salvo `status`, con transiciones `draft → sent | expired` y `sent → accepted | expired`, y salvo `package_id → NULL` (`ON DELETE SET NULL`). Las líneas no se pueden actualizar y `service_role` no tiene `UPDATE` ni `DELETE` sobre `quote_lines`.

### 6. Lecturas y escrituras

Las lecturas usan el cliente de sesión (RLS del dueño). La instantánea del evento se lee con `service_role`, como el lector de presupuesto, porque la política del catálogo solo expone módulos activos; se filtra por dueño después de `checkPackageAccess`. Las escrituras usan las RPC con `service_role`, que repiten el control de dueño. Un recurso ajeno o inexistente responde 404 indistinguible.

## Risks / Trade-offs

- Fórmula, rutas y semántica de versión son propuestas que Plane no define; se confirman en la revisión del PR.
- "Vencida" es manual; no hay tarea programada.
- La migración debe aplicarse en el proyecto Supabase alojado tras el merge.
