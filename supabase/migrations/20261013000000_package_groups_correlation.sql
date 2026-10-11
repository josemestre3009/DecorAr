-- Migration: propagate correlationId through the Composite RPCs
-- Requirement DECOR-25 / DECOR-31 integration: a leaf added through the group
-- path must carry the request's correlation id into its outbox row, exactly
-- like a root leaf committed through public.commit_package_change (DECOR-31).
--
-- Additive to 20261012000000_create_package_groups.sql. Both RPCs gain a
-- trailing `p_correlation_id text DEFAULT NULL` and forward it to
-- commit_package_change. The parameter defaults to NULL, so every existing
-- caller keeps working; the overloads with the old parameter count are dropped
-- first so only one signature remains resolvable, following the same
-- convention as 20261011000001_async_recovery.sql.

DROP FUNCTION IF EXISTS public.create_package_group(uuid, uuid, uuid, text, uuid, jsonb, integer);
DROP FUNCTION IF EXISTS public.add_package_item_to_group(jsonb, uuid, integer);

-- Creates a group and, optionally, its leaves in one transaction. Each leaf
-- is a package.module.added event committed through commit_package_change,
-- so a failing child rolls back the group, the other leaves and their
-- outbox rows. A group without leaves emits no event and keeps the version:
-- structural changes do not trigger a budget recalculation.
CREATE FUNCTION public.create_package_group(
  p_package_id uuid,
  p_user_id uuid,
  p_group_id uuid,
  p_name text,
  p_parent_group_id uuid DEFAULT NULL,
  p_events jsonb DEFAULT '[]'::jsonb,
  p_expected_version integer DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_version integer;
  v_depth integer;
  v_event jsonb;
  v_item_ids jsonb := '[]'::jsonb;
BEGIN
  IF p_package_id IS NULL OR p_user_id IS NULL OR p_group_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_group';
  END IF;

  IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'package.invalid_group_name';
  END IF;

  IF p_events IS NULL OR pg_catalog.jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'event.invalid';
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

  INSERT INTO public.package_groups (id, package_id, parent_group_id, name, depth)
  VALUES (p_group_id, p_package_id, p_parent_group_id, pg_catalog.btrim(p_name), 1)
  RETURNING depth INTO v_depth;

  FOR v_event IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_events) AS e(value)
  LOOP
    IF v_event ->> 'type' IS DISTINCT FROM 'package.module.added'
      OR pg_catalog.lower(v_event ->> 'packageId') IS DISTINCT FROM p_package_id::text
      OR pg_catalog.lower(v_event ->> 'userId') IS DISTINCT FROM p_user_id::text THEN
      RAISE EXCEPTION 'event.invalid';
    END IF;

    v_version := public.commit_package_change(v_event, NULL, p_correlation_id);

    UPDATE public.package_items AS i
    SET group_id = p_group_id
    WHERE i.id = (v_event -> 'payload' ->> 'itemId')::uuid
      AND i.package_id = p_package_id;

    v_item_ids := v_item_ids || pg_catalog.jsonb_build_array(v_event -> 'payload' ->> 'itemId');
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'groupId', p_group_id,
    'depth', v_depth,
    'itemIds', v_item_ids,
    'packageVersion', v_version
  );
END;
$$;

-- POST /items with parentGroupId: the same commit as a root leaf plus the
-- group assignment, in one transaction. A group from another package (or a
-- missing one) rolls back the item and its outbox row.
CREATE FUNCTION public.add_package_item_to_group(
  p_event jsonb,
  p_group_id uuid,
  p_expected_version integer DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_version integer;
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'package.group_not_found';
  END IF;

  IF p_event ->> 'type' IS DISTINCT FROM 'package.module.added' THEN
    RAISE EXCEPTION 'event.unsupported_type';
  END IF;

  v_version := public.commit_package_change(p_event, p_expected_version, p_correlation_id);

  UPDATE public.package_items AS i
  SET group_id = p_group_id
  WHERE i.id = (p_event -> 'payload' ->> 'itemId')::uuid
    AND i.package_id = (p_event ->> 'packageId')::uuid
    AND EXISTS (
      SELECT 1
      FROM public.package_groups AS g
      WHERE g.id = p_group_id AND g.package_id = i.package_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.group_not_found';
  END IF;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.create_package_group(uuid, uuid, uuid, text, uuid, jsonb, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_package_item_to_group(jsonb, uuid, integer, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_package_group(uuid, uuid, uuid, text, uuid, jsonb, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.add_package_item_to_group(jsonb, uuid, integer, text) TO service_role;
