-- DECOR-36 F3: corrected uniformly scaled assets, prepared for immutable publication.
INSERT INTO public.catalog_modules (
  asset_id,
  version,
  name,
  price_cop,
  area_m2,
  status
)
SELECT
  asset_id,
  2,
  name,
  price_cop,
  area_m2,
  'draft'
FROM public.catalog_modules
WHERE version = 1
  AND asset_id IN ('mesa', 'arco', 'pista')
ON CONFLICT (asset_id, version) DO NOTHING;
