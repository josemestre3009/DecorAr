-- DECOR-36 F4: preserve immutable versions while exposing one current version per asset.

ALTER TABLE public.catalog_modules
  DROP CONSTRAINT IF EXISTS chk_catalog_modules_status;

ALTER TABLE public.catalog_modules
  ADD CONSTRAINT chk_catalog_modules_status
  CHECK (status IN ('draft', 'active', 'retired'));

ALTER TABLE public.catalog_modules
  DROP CONSTRAINT IF EXISTS chk_catalog_modules_active_completeness;

ALTER TABLE public.catalog_modules
  ADD CONSTRAINT chk_catalog_modules_published_completeness CHECK (
    status = 'draft' OR (
      status IN ('active', 'retired') AND
      glb_url IS NOT NULL AND length(trim(glb_url)) > 0 AND
      usdz_url IS NOT NULL AND length(trim(usdz_url)) > 0 AND
      width_m IS NOT NULL AND
      height_m IS NOT NULL AND
      depth_m IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_modules_one_active_asset
  ON public.catalog_modules (asset_id)
  WHERE status = 'active';

-- Existing v1 rows were activated with unsupported hand-written dimensions.
-- glTF 2.0 defines linear distances in meters, so persist the measured native bounds.
UPDATE public.catalog_modules AS target
SET
  width_m = measured.width_m,
  height_m = measured.height_m,
  depth_m = measured.depth_m,
  updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
FROM (
  VALUES
    ('mesa'::text, 1, 13.714::numeric, 6.463::numeric, 8.139::numeric),
    ('arco'::text, 1, 7.369::numeric, 7.233::numeric, 1.521::numeric),
    ('pista'::text, 1, 7.020::numeric, 0.500::numeric, 7.020::numeric)
) AS measured(asset_id, version, width_m, height_m, depth_m)
WHERE target.asset_id = measured.asset_id
  AND target.version = measured.version;

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

  -- Serialize replacement attempts for the same logical asset, including its first publication.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_asset_id, 0));

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

  UPDATE public.catalog_modules
  SET status = 'retired', updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE asset_id = p_asset_id AND status = 'active';

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
