-- Seed initial modules for catalog in draft status
-- Requirement DECOR-28: Seed inicial de mesa, arco y pista

INSERT INTO public.catalog_modules (
  asset_id,
  version,
  name,
  price_cop,
  area_m2,
  width_m,
  height_m,
  depth_m,
  glb_url,
  usdz_url,
  poster_url,
  status
)
VALUES
  (
    'mesa',
    1,
    'Mesa redonda',
    250000,
    4.00,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'draft'
  ),
  (
    'arco',
    1,
    'Arco floral',
    200000,
    2.00,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'draft'
  ),
  (
    'pista',
    1,
    'Pista de baile',
    600000,
    16.00,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'draft'
  )
ON CONFLICT (asset_id, version) DO UPDATE SET
  name = EXCLUDED.name,
  price_cop = EXCLUDED.price_cop,
  area_m2 = EXCLUDED.area_m2,
  status = EXCLUDED.status,
  updated_at = timezone('utc'::text, now());
