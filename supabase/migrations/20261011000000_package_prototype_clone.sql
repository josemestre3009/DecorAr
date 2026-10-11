-- Migration: additive extension to public.packages and atomic clone RPC for Prototype pattern
-- Requirement DECOR-24: Rafael 3/6: implementar Prototype y clonación profunda
--
-- Extends packages with preference columns (style, colors, notes).
-- Implements atomic clone_package RPC (SECURITY INVOKER, search_path='', service_role only).
-- Does not emit domain events or recalculate budget until subsequent mutation.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS style TEXT,
  ADD COLUMN IF NOT EXISTS colors JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

CREATE OR REPLACE FUNCTION public.clone_package(
  p_source_package_id uuid,
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source public.packages%ROWTYPE;
  v_new_package_id uuid;
  v_items_count integer := 0;
BEGIN
  IF p_source_package_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_source';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_user';
  END IF;

  -- Lock source package for share to ensure consistent read during clone
  SELECT * INTO v_source
  FROM public.packages
  WHERE id = p_source_package_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  -- Generate new package ID
  v_new_package_id := pg_catalog.gen_random_uuid();

  -- Insert cloned package with new id, new timestamp, version = 1, assigned to target user
  INSERT INTO public.packages (
    id,
    user_id,
    space_type,
    capacity_m2,
    style,
    colors,
    notes,
    version,
    created_at,
    updated_at
  ) VALUES (
    v_new_package_id,
    p_target_user_id,
    v_source.space_type,
    v_source.capacity_m2,
    v_source.style,
    coalesce(v_source.colors, '[]'::jsonb),
    coalesce(v_source.notes, ''),
    1,
    pg_catalog.timezone('utc'::text, pg_catalog.now()),
    pg_catalog.timezone('utc'::text, pg_catalog.now())
  );

  -- Deep copy mutable item instances: new item UUID, new package_id, same module_id
  INSERT INTO public.package_items (
    id,
    package_id,
    module_id,
    created_at
  )
  SELECT
    pg_catalog.gen_random_uuid(),
    v_new_package_id,
    pi.module_id,
    pg_catalog.timezone('utc'::text, pg_catalog.now())
  FROM public.package_items pi
  WHERE pi.package_id = p_source_package_id;

  GET DIAGNOSTICS v_items_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_new_package_id,
    'spaceType', v_source.space_type,
    'capacityM2', v_source.capacity_m2,
    'style', v_source.style,
    'colors', coalesce(v_source.colors, '[]'::jsonb),
    'notes', coalesce(v_source.notes, ''),
    'version', 1,
    'itemCount', v_items_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clone_package(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_package(uuid, uuid) TO service_role;
