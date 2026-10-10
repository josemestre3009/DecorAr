-- Migration: additive extension to public.packages for Package Builder
-- Requirement DECOR-27: PaqueteDecoracion, TipoEspacio, capacidad y Builder.
--
-- Extends the minimal package aggregate from DECOR-32 with space_type and capacity_m2.
-- Provides a server-only atomic RPC create_package to create valid packages.
-- Security: SECURITY INVOKER, search_path='', service_role execution only.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS space_type TEXT,
  ADD COLUMN IF NOT EXISTS capacity_m2 NUMERIC(8, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'chk_packages_space_type'
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT chk_packages_space_type
      CHECK (space_type IN ('casa', 'aireLibre', 'salonSocial'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'chk_packages_capacity_positive'
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT chk_packages_capacity_positive
      CHECK (capacity_m2 > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_package(
  p_user_id uuid,
  p_space_type text,
  p_capacity_m2 numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_user';
  END IF;

  IF p_space_type IS NULL OR p_space_type NOT IN ('casa', 'aireLibre', 'salonSocial') THEN
    RAISE EXCEPTION 'package.invalid_space_type';
  END IF;

  IF p_capacity_m2 IS NULL OR p_capacity_m2 <= 0 THEN
    RAISE EXCEPTION 'package.invalid_capacity';
  END IF;

  INSERT INTO public.packages (user_id, space_type, capacity_m2, version)
  VALUES (p_user_id, p_space_type, p_capacity_m2, 1)
  RETURNING id INTO v_id;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_id,
    'spaceType', p_space_type,
    'capacityM2', p_capacity_m2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_package(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_package(uuid, text, numeric) TO service_role;
