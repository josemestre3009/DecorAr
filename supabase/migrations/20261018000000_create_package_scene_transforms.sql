-- Migration: per-unit scene transforms (position + horizontal rotation)
-- Requirement DECOR-46: Luis: guardar posición y rotación de cada objeto
--
-- Each package_items row is already one unit (even a quantity > 1 module adds
-- N rows with their own UUID, see add_package_items_batch). This migration
-- adds where each unit sits in the AR scene, keyed by that same item_id:
--   * public.package_scenes     one row per package, its own version counter.
--   * public.package_item_transforms  one row per unit, FK to package_items.
--
-- The scene has its OWN version (package_scenes.version), never
-- packages.version: moving an object must not bump the version the Composite
-- editor and the budget consumer watch, and must not recalculate the budget.
-- save_package_scene therefore never calls insert_package_outbox_event and
-- never touches public.packages or public.budgets.
--
-- Units are relative to an origin the mount itself defines (not the WebXR
-- session origin, which changes every time). Units: metres for x/y/z,
-- degrees for the horizontal rotation, same as the AR domain
-- (src/modules/ar/domain/instancia-decorativa.ts). Bounds are enforced here
-- as CHECK constraints and, in TypeScript, by EscenaMontaje: defense in
-- depth, same pattern as the rest of packages.

CREATE TABLE IF NOT EXISTS public.package_scenes (
  package_id UUID PRIMARY KEY REFERENCES public.packages (id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chk_package_scenes_version_non_negative CHECK (version >= 0)
);

-- A composite FK from package_item_transforms needs a unique target on
-- (id, package_id). package_items.id is already the primary key, so this is
-- an additional unique constraint for that purpose only, same pattern as
-- uq_package_groups_id_package in 20261012000000_create_package_groups.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_package_items_id_package'
  ) THEN
    ALTER TABLE public.package_items
      ADD CONSTRAINT uq_package_items_id_package UNIQUE (id, package_id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.package_item_transforms (
  item_id UUID PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES public.package_scenes (package_id) ON DELETE CASCADE,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  z DOUBLE PRECISION NOT NULL,
  rotation_deg DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT fk_package_item_transforms_item FOREIGN KEY (item_id, package_id)
    REFERENCES public.package_items (id, package_id) ON DELETE CASCADE,
  CONSTRAINT chk_package_item_transforms_x CHECK (x BETWEEN -50 AND 50),
  CONSTRAINT chk_package_item_transforms_y CHECK (y BETWEEN -1 AND 5),
  CONSTRAINT chk_package_item_transforms_z CHECK (z BETWEEN -50 AND 50),
  CONSTRAINT chk_package_item_transforms_rotation CHECK (rotation_deg >= 0 AND rotation_deg < 360)
);

CREATE INDEX IF NOT EXISTS idx_package_item_transforms_package_id
  ON public.package_item_transforms (package_id);

-- Deny-all until the policies below grant owner-only SELECT; every write
-- goes through save_package_scene (service_role only).
ALTER TABLE public.package_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_item_transforms ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.package_scenes, public.package_item_transforms
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.package_scenes, public.package_item_transforms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.package_scenes, public.package_item_transforms
  TO service_role;

DROP POLICY IF EXISTS "Owners can view scene of their packages" ON public.package_scenes;
CREATE POLICY "Owners can view scene of their packages"
  ON public.package_scenes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.packages AS p
      WHERE p.id = package_scenes.package_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners can view transforms of their packages" ON public.package_item_transforms;
CREATE POLICY "Owners can view transforms of their packages"
  ON public.package_item_transforms
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.packages AS p
      WHERE p.id = package_item_transforms.package_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- save_package_scene: atomic full replace, version +1, no outbox/budget side
-- effects.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_package_scene(
  p_package_id uuid,
  p_user_id uuid,
  p_transforms jsonb,
  p_expected_version integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_version integer;
  v_count integer;
  v_valid_count integer;
BEGIN
  IF p_transforms IS NULL OR pg_catalog.jsonb_typeof(p_transforms) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'scene.invalid_body';
  END IF;

  SELECT p.user_id INTO v_owner
  FROM public.packages AS p
  WHERE p.id = p_package_id
  FOR UPDATE;

  IF NOT FOUND OR v_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  INSERT INTO public.package_scenes (package_id, version)
  VALUES (p_package_id, 0)
  ON CONFLICT (package_id) DO NOTHING;

  SELECT s.version INTO v_version
  FROM public.package_scenes AS s
  WHERE s.package_id = p_package_id
  FOR UPDATE;

  IF p_expected_version IS NOT NULL AND v_version <> p_expected_version THEN
    RAISE EXCEPTION 'scene.version_conflict'
      USING DETAIL = v_version::text;
  END IF;

  SELECT count(*) INTO v_count FROM pg_catalog.jsonb_array_elements(p_transforms);

  IF v_count > 100 THEN
    RAISE EXCEPTION 'scene.too_many_items';
  END IF;

  -- Every item_id must belong to this package before anything is written.
  SELECT count(*) INTO v_valid_count
  FROM pg_catalog.jsonb_array_elements(p_transforms) AS elem
  JOIN public.package_items AS i
    ON i.id = (elem ->> 'itemId')::uuid AND i.package_id = p_package_id;

  IF v_valid_count <> v_count THEN
    RAISE EXCEPTION 'scene.item_not_found';
  END IF;

  DELETE FROM public.package_item_transforms WHERE package_id = p_package_id;

  INSERT INTO public.package_item_transforms (item_id, package_id, x, y, z, rotation_deg)
  SELECT
    (elem ->> 'itemId')::uuid,
    p_package_id,
    (elem ->> 'x')::double precision,
    (elem ->> 'y')::double precision,
    (elem ->> 'z')::double precision,
    (elem ->> 'rotationDeg')::double precision
  FROM pg_catalog.jsonb_array_elements(p_transforms) AS elem;

  UPDATE public.package_scenes AS s
  SET version = s.version + 1,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE s.package_id = p_package_id
  RETURNING s.version INTO v_version;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.save_package_scene(uuid, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_package_scene(uuid, uuid, jsonb, integer)
  TO service_role;
