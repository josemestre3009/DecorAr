-- DECOR-23 F1: arco y pista v2 estaban descentrados (centro X/Z != 0, base bajo el origen),
-- así que en AR no se apoyaban en el punto colocado. v3 los recentra sin cambiar la escala.
-- La RPC activate_catalog_module exige una fila draft previa; se siembra aquí.
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
  3,
  name,
  price_cop,
  area_m2,
  'draft'
FROM public.catalog_modules
WHERE version = 2
  AND asset_id IN ('arco', 'pista')
ON CONFLICT (asset_id, version) DO NOTHING;
