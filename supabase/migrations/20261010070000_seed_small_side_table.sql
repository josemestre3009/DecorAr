-- Modelo ligero para demostrar AR a escala real en espacios reducidos.
INSERT INTO public.catalog_modules (
  asset_id,
  version,
  name,
  price_cop,
  area_m2,
  status
)
VALUES (
  'mesa-auxiliar',
  1,
  'Mesa auxiliar compacta',
  85000,
  0.27,
  'draft'
)
ON CONFLICT (asset_id, version) DO NOTHING;
