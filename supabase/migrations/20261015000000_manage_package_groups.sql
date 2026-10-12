-- Migration: rename and delete decorative groups
-- Requirement DECOR-43: organizar grupos decorativos antes del catálogo
--
-- Renaming changes only the name. Deleting a group never deletes content:
-- its leaves and subgroups move up to the deleted group's parent (or to the
-- package root) and the group is removed last, all in one transaction.
--
-- Neither operation changes the set of modules, so neither emits a module
-- event nor touches the budget. They bump packages.structure_version
-- instead of packages.version: the live budget (DECOR-21) waits for a
-- recalculation whenever packages.version moves ahead of the budget, and a
-- structural change never produces one.
--
-- Tree position stays immutable for direct writes (DECOR-25): only
-- delete_package_group may re-parent, through a transaction-local flag, and
-- it re-checks the whole tree before committing.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS structure_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_packages_structure_version_positive'
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT chk_packages_structure_version_positive CHECK (structure_version > 0);
  END IF;
END;
$$;

-- Same rules as DECOR-25, plus one exception: while the transaction-local
-- setting decorar.group_reparent is 'on' (set only by delete_package_group),
-- parent and depth may change. The package never changes.
CREATE OR REPLACE FUNCTION public.set_package_group_depth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_parent_depth integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.package_id IS DISTINCT FROM OLD.package_id THEN
      RAISE EXCEPTION 'package.group_immutable';
    END IF;

    IF pg_catalog.current_setting('decorar.group_reparent', true) = 'on' THEN
      RETURN NEW;
    END IF;

    IF NEW.parent_group_id IS DISTINCT FROM OLD.parent_group_id THEN
      RAISE EXCEPTION 'package.group_immutable';
    END IF;
    NEW.depth := OLD.depth;
    RETURN NEW;
  END IF;

  IF NEW.parent_group_id IS NULL THEN
    NEW.depth := 1;
    RETURN NEW;
  END IF;

  SELECT g.depth INTO v_parent_depth
  FROM public.package_groups AS g
  WHERE g.id = NEW.parent_group_id AND g.package_id = NEW.package_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.group_not_found';
  END IF;

  IF v_parent_depth + 1 > 3 THEN
    RAISE EXCEPTION 'package.group_depth_exceeded';
  END IF;

  NEW.depth := v_parent_depth + 1;
  RETURN NEW;
END;
$$;

-- Renames a group of the caller's package. Children, leaves and depth are
-- untouched.
CREATE OR REPLACE FUNCTION public.rename_package_group(
  p_package_id uuid,
  p_user_id uuid,
  p_group_id uuid,
  p_name text,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_version integer;
  v_structure_version integer;
  v_name text;
BEGIN
  IF p_package_id IS NULL OR p_user_id IS NULL OR p_group_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_group';
  END IF;

  IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'package.invalid_group_name';
  END IF;

  SELECT p.version INTO v_version
  FROM public.packages AS p
  WHERE p.id = p_package_id AND p.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  IF p_expected_version IS NOT NULL AND v_version <> p_expected_version THEN
    RAISE EXCEPTION 'package.version_conflict';
  END IF;

  v_name := pg_catalog.btrim(p_name);

  UPDATE public.package_groups AS g
  SET name = v_name
  WHERE g.id = p_group_id AND g.package_id = p_package_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.group_not_found';
  END IF;

  UPDATE public.packages AS p
  SET structure_version = p.structure_version + 1,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE p.id = p_package_id
  RETURNING p.structure_version INTO v_structure_version;

  RETURN pg_catalog.jsonb_build_object(
    'groupId', p_group_id,
    'name', v_name,
    'structureVersion', v_structure_version
  );
END;
$$;

-- Deletes a group without deleting its content. Order: lock the package,
-- check owner and version, move the leaves and the subtree up one level,
-- verify the whole tree, and delete the group last. Any failure rolls back
-- every step.
CREATE OR REPLACE FUNCTION public.delete_package_group(
  p_package_id uuid,
  p_user_id uuid,
  p_group_id uuid,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_version integer;
  v_structure_version integer;
  v_parent_id uuid;
  v_promoted_items integer;
  v_promoted_groups integer;
BEGIN
  IF p_package_id IS NULL OR p_user_id IS NULL OR p_group_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_group';
  END IF;

  SELECT p.version INTO v_version
  FROM public.packages AS p
  WHERE p.id = p_package_id AND p.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  IF p_expected_version IS NOT NULL AND v_version <> p_expected_version THEN
    RAISE EXCEPTION 'package.version_conflict';
  END IF;

  SELECT g.parent_group_id INTO v_parent_id
  FROM public.package_groups AS g
  WHERE g.id = p_group_id AND g.package_id = p_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.group_not_found';
  END IF;

  PERFORM pg_catalog.set_config('decorar.group_reparent', 'on', true);

  UPDATE public.package_items AS i
  SET group_id = v_parent_id
  WHERE i.package_id = p_package_id AND i.group_id = p_group_id;
  GET DIAGNOSTICS v_promoted_items = ROW_COUNT;

  SELECT pg_catalog.count(*) INTO v_promoted_groups
  FROM public.package_groups AS g
  WHERE g.package_id = p_package_id AND g.parent_group_id = p_group_id;

  -- Every descendant goes up one level; direct children take the deleted
  -- group's parent.
  WITH RECURSIVE subtree AS (
    SELECT g.id
    FROM public.package_groups AS g
    WHERE g.package_id = p_package_id AND g.parent_group_id = p_group_id
    UNION ALL
    SELECT g.id
    FROM public.package_groups AS g
    JOIN subtree AS s ON g.parent_group_id = s.id
    WHERE g.package_id = p_package_id
  )
  UPDATE public.package_groups AS g
  SET depth = g.depth - 1,
      parent_group_id = CASE WHEN g.parent_group_id = p_group_id THEN v_parent_id ELSE g.parent_group_id END
  FROM subtree AS s
  WHERE g.id = s.id;

  DELETE FROM public.package_groups AS g
  WHERE g.id = p_group_id AND g.package_id = p_package_id;

  PERFORM pg_catalog.set_config('decorar.group_reparent', 'off', true);

  -- Defense: after the move, every group must sit exactly one level below
  -- its parent, inside 1..3, and no leaf may point to the deleted group.
  IF EXISTS (
    SELECT 1
    FROM public.package_groups AS c
    LEFT JOIN public.package_groups AS parent
      ON parent.id = c.parent_group_id AND parent.package_id = c.package_id
    WHERE c.package_id = p_package_id
      AND (
        (c.parent_group_id IS NULL AND c.depth <> 1)
        OR (c.parent_group_id IS NOT NULL AND (parent.id IS NULL OR c.depth <> parent.depth + 1))
      )
  ) OR EXISTS (
    SELECT 1 FROM public.package_items AS i
    WHERE i.package_id = p_package_id AND i.group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'package.group_integrity';
  END IF;

  UPDATE public.packages AS p
  SET structure_version = p.structure_version + 1,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE p.id = p_package_id
  RETURNING p.structure_version INTO v_structure_version;

  RETURN pg_catalog.jsonb_build_object(
    'groupId', p_group_id,
    'parentGroupId', v_parent_id,
    'promotedGroups', v_promoted_groups,
    'promotedItems', v_promoted_items,
    'structureVersion', v_structure_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rename_package_group(uuid, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_package_group(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rename_package_group(uuid, uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_package_group(uuid, uuid, uuid, integer) TO service_role;
