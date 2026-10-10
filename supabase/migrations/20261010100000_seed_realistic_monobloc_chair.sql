-- Silla plástica monobloque realista para eventos, publicada como versión inmutable.
INSERT INTO public.catalog_modules (asset_id, version, name, price_cop, area_m2, status)
VALUES ('silla', 2, 'Silla plástica clásica', 70000, 0.40, 'draft')
ON CONFLICT (asset_id, version) DO NOTHING;
