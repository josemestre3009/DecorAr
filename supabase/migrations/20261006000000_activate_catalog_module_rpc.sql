-- Migration: activate_catalog_module RPC function
-- Requirement DECOR-36: Activación atómica con SECURITY INVOKER y search_path vacío

CREATE OR REPLACE FUNCTION public.activate_catalog_module(
  p_asset_id text,
  p_version integer,
  p_glb_url text,
  p_usdz_url text,
  p_poster_url text,
  p_width_m numeric,
  p_height_m numeric,
  p_depth_m numeric
)
RETURNS public.catalog_modules
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_module public.catalog_modules;
BEGIN
  -- Validate required inputs
  IF p_asset_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_asset_id)) = 0 THEN
    RAISE EXCEPTION 'asset_id cannot be empty';
  END IF;

  IF p_version IS NULL OR p_version < 1 THEN
    RAISE EXCEPTION 'version must be an integer >= 1';
  END IF;

  IF p_glb_url IS NULL OR pg_catalog.length(pg_catalog.btrim(p_glb_url)) = 0 OR NOT (p_glb_url LIKE 'https://%') THEN
    RAISE EXCEPTION 'glb_url must be a valid HTTPS URL';
  END IF;

  IF p_usdz_url IS NULL OR pg_catalog.length(pg_catalog.btrim(p_usdz_url)) = 0 OR NOT (p_usdz_url LIKE 'https://%') THEN
    RAISE EXCEPTION 'usdz_url must be a valid HTTPS URL';
  END IF;

  IF p_poster_url IS NULL OR pg_catalog.length(pg_catalog.btrim(p_poster_url)) = 0 OR NOT (p_poster_url LIKE 'https://%') THEN
    RAISE EXCEPTION 'poster_url must be a valid HTTPS URL';
  END IF;

  IF p_width_m IS NULL OR p_width_m <= 0 THEN
    RAISE EXCEPTION 'width_m must be a number > 0';
  END IF;

  IF p_height_m IS NULL OR p_height_m <= 0 THEN
    RAISE EXCEPTION 'height_m must be a number > 0';
  END IF;

  IF p_depth_m IS NULL OR p_depth_m <= 0 THEN
    RAISE EXCEPTION 'depth_m must be a number > 0';
  END IF;

  -- Inspect row with row-level locking and ensure draft status
  SELECT * INTO v_module
  FROM public.catalog_modules
  WHERE asset_id = p_asset_id AND version = p_version
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalog module with asset_id % and version % not found', p_asset_id, p_version;
  END IF;

  IF v_module.status <> 'draft' THEN
    RAISE EXCEPTION 'Catalog module with asset_id % and version % is not in draft status (current status: %)',
      p_asset_id, p_version, v_module.status;
  END IF;

  -- Atomic update of module from draft to active
  UPDATE public.catalog_modules
  SET
    glb_url = pg_catalog.btrim(p_glb_url),
    usdz_url = pg_catalog.btrim(p_usdz_url),
    poster_url = pg_catalog.btrim(p_poster_url),
    width_m = p_width_m,
    height_m = p_height_m,
    depth_m = p_depth_m,
    status = 'active',
    updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE id = v_module.id
  RETURNING * INTO v_module;

  RETURN v_module;
END;
$$;
