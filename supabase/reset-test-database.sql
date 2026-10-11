-- ============================================================================
-- DecorAR: Script de Reseteo y Limpieza Server-Side (DECOR-26)
-- ============================================================================
-- Este script limpia de forma idempotente y segura todo el estado mutable
-- generado durante pruebas automatizadas o manuales en la base de datos
-- alojada de Supabase, preservando las migraciones, la estructura DDL y los
-- módulos activos del catálogo (public.catalog_modules).
--
-- Ejecución:
-- Puede ejecutarse directamente en la consola SQL de Supabase (SQL Editor),
-- mediante psql/curl hacia la Management API, o programáticamente desde la
-- suite de integración usando credenciales de service_role.
-- No requiere el CLI local de Supabase ni stacks locales.
-- ============================================================================

BEGIN;

-- 1. Limpieza de registro de eventos procesados y outbox (esquema privado)
DELETE FROM private.processed_events;
DELETE FROM private.domain_events;

-- 2. Limpieza de presupuestos persistidos
DELETE FROM public.budgets;

-- 3. Limpieza de hojas (package_items) y grupos (package_groups)
DELETE FROM public.package_items;
DELETE FROM public.package_groups;

-- 4. Limpieza de paquetes de usuarios
DELETE FROM public.packages;

COMMIT;
