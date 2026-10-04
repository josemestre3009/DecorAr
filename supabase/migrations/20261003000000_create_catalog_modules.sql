-- Migration: create catalog_modules table and policies
-- Requirement DECOR-28: Base de datos del catálogo

CREATE TABLE IF NOT EXISTS public.catalog_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  price_cop INTEGER NOT NULL,
  area_m2 NUMERIC(10, 2) NOT NULL,
  width_m NUMERIC(10, 2),
  height_m NUMERIC(10, 2),
  depth_m NUMERIC(10, 2),
  glb_url TEXT,
  usdz_url TEXT,
  poster_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT uq_catalog_modules_asset_version UNIQUE (asset_id, version),
  CONSTRAINT chk_catalog_modules_status CHECK (status IN ('draft', 'active')),
  CONSTRAINT chk_catalog_modules_price_positive CHECK (price_cop > 0),
  CONSTRAINT chk_catalog_modules_area_positive CHECK (area_m2 > 0),
  CONSTRAINT chk_catalog_modules_width_positive CHECK (width_m IS NULL OR width_m > 0),
  CONSTRAINT chk_catalog_modules_height_positive CHECK (height_m IS NULL OR height_m > 0),
  CONSTRAINT chk_catalog_modules_depth_positive CHECK (depth_m IS NULL OR depth_m > 0),
  CONSTRAINT chk_catalog_modules_active_completeness CHECK (
    status = 'draft' OR (
      status = 'active' AND
      glb_url IS NOT NULL AND
      usdz_url IS NOT NULL AND
      width_m IS NOT NULL AND
      height_m IS NOT NULL AND
      depth_m IS NOT NULL
    )
  )
);

-- Index for querying active modules efficiently
CREATE INDEX IF NOT EXISTS idx_catalog_modules_active_status
  ON public.catalog_modules (status)
  WHERE status = 'active';

-- Enable Row Level Security (RLS)
ALTER TABLE public.catalog_modules ENABLE ROW LEVEL SECURITY;

-- Allow public read access strictly for active modules
DROP POLICY IF EXISTS "Public can view active catalog modules" ON public.catalog_modules;
CREATE POLICY "Public can view active catalog modules"
  ON public.catalog_modules
  FOR SELECT
  TO public
  USING (status = 'active');
