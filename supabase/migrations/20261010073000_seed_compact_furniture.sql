-- Nueva versión de la mesa con poster fiel al GLB y silla compacta para espacios pequeños.
INSERT INTO public.catalog_modules (asset_id, version, name, price_cop, area_m2, status)
VALUES
  ('mesa-auxiliar', 2, 'Mesa auxiliar compacta', 85000, 0.27, 'draft'),
  ('silla', 1, 'Silla tapizada compacta', 70000, 0.26, 'draft')
ON CONFLICT (asset_id, version) DO NOTHING;
