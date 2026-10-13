-- Migration: editable decorative groups (rename, reparent, delete, move item)
-- Requirement editable-decorative-groups (tasks 3.1-3.6)
--
-- Additive to 20261015000000_event_templates_and_metadata.sql (DECOR-44).
--
--   1. Replaces the "position is immutable" trigger by a reparent that keeps
--      the SQL defense: a group may change parent inside the same package, but
--      never into itself or a descendant (cycle) and never past level 3
--      (depth). Depth is still derived from the parent on every write.
--   2. Adds the RPCs the editor needs, each as invoker with an empty
--      search_path and fully qualified names, executable only by service_role:
--        * create_package_group  (adjusted: an empty zone bumps the version)
--        * update_package_group  (rename and/or reparent, version +1)
--        * delete_package_group  (move_to_root | delete_contents, version +1)
--        * move_package_item     (relocate one item, version +1)
--   3. Every RPC locks the owning package FOR UPDATE and checks
--      expectedVersion + ownership in the same transaction, so all rows,
--      the outbox and the version change together or not at all.
--
-- Outbox events are built by the caller and persisted by the RPC, exactly like
-- create_package_group already did with package.module.added leaves:
--   * move_package_item and the move_to_root strategy consume
--     `package.module.moved` (payload.itemId/moduleId, and the viewer may add
--     fromGroupId/toGroupId; the origin/destination the UI needs).
--   * delete_contents consumes `package.module.removed`, one per subtree item.
-- Structural renames/reparents emit no item event: they only bump the version.
-- The shared event contract/parser/publisher/budget consumer must learn
-- `package.module.moved` (tasks 1.3/2.4); this migration only guarantees the
-- row is written atomically.

-- ---------------------------------------------------------------------------
-- 1. Reparentable tree with SQL cycle/depth defense
-- ---------------------------------------------------------------------------

-- Depth is still derived from the parent on insert and update. On update the
-- package of a group can never change, and a move into itself or a descendant
-- raises `package.group_cycle`, so no cycle can be formed even from raw SQL.
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

    IF NEW.parent_group_id = NEW.id THEN
      RAISE EXCEPTION 'package.group_cycle';
    END IF;

    IF NEW.parent_group_id IS DISTINCT FROM OLD.parent_group_id
      AND NEW.parent_group_id IS NOT NULL THEN
      IF EXISTS (
        WITH RECURSIVE subtree AS (
          SELECT g.id
          FROM public.package_groups AS g
          WHERE g.parent_group_id = OLD.id AND g.package_id = OLD.package_id
          UNION ALL
          SELECT g.id
          FROM public.package_groups AS g
          JOIN subtree AS s ON g.parent_group_id = s.id
          WHERE g.package_id = OLD.package_id
        )
        SELECT 1 FROM subtree WHERE id = NEW.parent_group_id
      ) THEN
        RAISE EXCEPTION 'package.group_cycle';
      END IF;
    END IF;
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

-- ---------------------------------------------------------------------------
-- 2. Outbox helper (caller-provided event, version handled by each RPC)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.insert_package_outbox_event(
  p_event jsonb,
  p_expected_type text,
  p_package_id uuid,
  p_user_id uuid,
  p_correlation_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_event_id text := p_event ->> 'eventId';
BEGIN
  IF p_event -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN
    RAISE EXCEPTION 'event.unsupported_version';
  END IF;

  IF p_event ->> 'type' IS DISTINCT FROM p_expected_type THEN
    RAISE EXCEPTION 'event.unsupported_type';
  END IF;

  IF v_event_id IS NULL OR pg_catalog.length(pg_catalog.btrim(v_event_id)) = 0
    OR p_event ->> 'occurredAt' IS NULL
    OR pg_catalog.lower(p_event ->> 'userId') IS DISTINCT FROM pg_catalog.lower(p_user_id::text)
    OR pg_catalog.lower(p_event ->> 'packageId') IS DISTINCT FROM pg_catalog.lower(p_package_id::text)
    OR p_event -> 'payload' ->> 'itemId' IS NULL
    OR p_event -> 'payload' ->> 'itemId' !~ v_uuid
    OR p_event -> 'payload' ->> 'moduleId' IS NULL
    OR p_event -> 'payload' ->> 'moduleId' !~ v_uuid THEN
    RAISE EXCEPTION 'event.invalid';
  END IF;

  IF EXISTS (SELECT 1 FROM private.domain_events AS d WHERE d.event_id = v_event_id) THEN
    RAISE EXCEPTION 'event.duplicate';
  END IF;

  BEGIN
    INSERT INTO private.domain_events (
      event_id, event_type, package_id, user_id, occurred_at, event, correlation_id
    ) VALUES (
      v_event_id,
      p_expected_type,
      p_package_id,
      p_user_id,
      (p_event ->> 'occurredAt')::timestamptz,
      p_event,
      p_correlation_id
    );
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'event.duplicate';
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. create_package_group: an empty zone still bumps the version once
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_package_group(
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

  -- A structural change now versions the aggregate even without leaves, so a
  -- later mutation cannot reuse a stale expectedVersion. With leaves the
  -- per-leaf commit already moved the version.
  IF pg_catalog.jsonb_array_length(p_events) = 0 THEN
    UPDATE public.packages AS p
    SET version = p.version + 1,
        updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
    WHERE p.id = p_package_id
    RETURNING p.version INTO v_version;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'groupId', p_group_id,
    'depth', v_depth,
    'itemIds', v_item_ids,
    'packageVersion', v_version
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. update_package_group: rename and/or reparent, version +1
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_package_group(
  p_package_id uuid,
  p_user_id uuid,
  p_group_id uuid,
  p_name text DEFAULT NULL,
  p_parent_group_id uuid DEFAULT NULL,
  p_reparent boolean DEFAULT false,
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
  v_row public.package_groups%ROWTYPE;
  v_has_name boolean := p_name IS NOT NULL;
  v_iterations integer := 0;
BEGIN
  IF p_package_id IS NULL OR p_user_id IS NULL OR p_group_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_group';
  END IF;

  IF NOT v_has_name AND NOT p_reparent THEN
    RAISE EXCEPTION 'package.invalid_update';
  END IF;

  IF v_has_name AND pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
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

  SELECT * INTO v_row
  FROM public.package_groups AS g
  WHERE g.id = p_group_id AND g.package_id = p_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.group_not_found';
  END IF;

  IF p_reparent THEN
    IF p_parent_group_id = p_group_id THEN
      RAISE EXCEPTION 'package.group_cycle';
    END IF;

    IF p_parent_group_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.package_groups AS g
        WHERE g.id = p_parent_group_id AND g.package_id = p_package_id
      ) THEN
        RAISE EXCEPTION 'package.group_not_found';
      END IF;

      IF EXISTS (
        WITH RECURSIVE subtree AS (
          SELECT g.id FROM public.package_groups AS g
          WHERE g.parent_group_id = p_group_id AND g.package_id = p_package_id
          UNION ALL
          SELECT g.id FROM public.package_groups AS g
          JOIN subtree AS s ON g.parent_group_id = s.id
          WHERE g.package_id = p_package_id
        )
        SELECT 1 FROM subtree WHERE id = p_parent_group_id
      ) THEN
        RAISE EXCEPTION 'package.group_cycle';
      END IF;
    END IF;
  END IF;

  UPDATE public.package_groups AS g
  SET name = CASE WHEN v_has_name THEN pg_catalog.btrim(p_name) ELSE g.name END,
      parent_group_id = CASE WHEN p_reparent THEN p_parent_group_id ELSE g.parent_group_id END
  WHERE g.id = p_group_id AND g.package_id = p_package_id;

  -- The trigger re-derived the moved zone's depth. Descendants still carry
  -- their old depth, so walk the tree parents-first until stable (height <= 3).
  IF p_reparent THEN
    LOOP
      v_iterations := v_iterations + 1;

      UPDATE public.package_groups AS g
      SET depth = parent.depth + 1
      FROM public.package_groups AS parent
      WHERE g.parent_group_id = parent.id
        AND g.package_id = p_package_id
        AND g.depth <> parent.depth + 1;

      EXIT WHEN NOT FOUND OR v_iterations >= 10;
    END LOOP;
  END IF;

  UPDATE public.packages AS p
  SET version = p.version + 1,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE p.id = p_package_id
  RETURNING p.version INTO v_version;

  SELECT * INTO v_row FROM public.package_groups WHERE id = p_group_id;

  RETURN pg_catalog.jsonb_build_object(
    'groupId', v_row.id,
    'name', v_row.name,
    'parentGroupId', v_row.parent_group_id,
    'depth', v_row.depth,
    'packageVersion', v_version
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. delete_package_group: move_to_root | delete_contents, version +1
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_package_group(
  p_package_id uuid,
  p_user_id uuid,
  p_group_id uuid,
  p_strategy text,
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
  v_event jsonb;
  v_event_count integer := 0;
  v_direct_items jsonb := '[]'::jsonb;
  v_subtree_items jsonb := '[]'::jsonb;
  v_iterations integer := 0;
BEGIN
  IF p_package_id IS NULL OR p_user_id IS NULL OR p_group_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_group';
  END IF;

  IF p_strategy IS NULL OR p_strategy NOT IN ('move_to_root', 'delete_contents') THEN
    RAISE EXCEPTION 'package.invalid_strategy';
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

  PERFORM 1
  FROM public.package_groups AS g
  WHERE g.id = p_group_id AND g.package_id = p_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.group_not_found';
  END IF;

  IF p_strategy = 'move_to_root' THEN
    -- Modules directly in the zone, captured before anything moves.
    SELECT coalesce(pg_catalog.jsonb_agg(i.id), '[]'::jsonb) INTO v_direct_items
    FROM public.package_items AS i
    WHERE i.package_id = p_package_id AND i.group_id = p_group_id;

    -- Direct subzones go to the root keeping their own subtree intact.
    UPDATE public.package_groups AS g
    SET parent_group_id = NULL
    WHERE g.parent_group_id = p_group_id AND g.package_id = p_package_id;

    LOOP
      v_iterations := v_iterations + 1;

      UPDATE public.package_groups AS g
      SET depth = parent.depth + 1
      FROM public.package_groups AS parent
      WHERE g.parent_group_id = parent.id
        AND g.package_id = p_package_id
        AND g.depth <> parent.depth + 1;

      EXIT WHEN NOT FOUND OR v_iterations >= 10;
    END LOOP;

    UPDATE public.package_items AS i
    SET group_id = NULL
    WHERE i.package_id = p_package_id AND i.group_id = p_group_id;

    FOR v_event IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_events) AS e(value)
    LOOP
      IF v_event ->> 'type' IS DISTINCT FROM 'package.module.moved'
        OR NOT v_direct_items @> pg_catalog.jsonb_build_array(v_event -> 'payload' ->> 'itemId') THEN
        RAISE EXCEPTION 'event.invalid';
      END IF;

      PERFORM public.insert_package_outbox_event(
        v_event, 'package.module.moved', p_package_id, p_user_id, p_correlation_id
      );
      v_event_count := v_event_count + 1;
    END LOOP;

    -- Every direct module must be described by exactly one moved event.
    IF v_event_count <> pg_catalog.jsonb_array_length(v_direct_items) THEN
      RAISE EXCEPTION 'event.invalid';
    END IF;

    DELETE FROM public.package_groups AS g
    WHERE g.id = p_group_id AND g.package_id = p_package_id;
  ELSE
    -- Whole subtree: modules get a removal event and the zones disappear.
    SELECT coalesce(pg_catalog.jsonb_agg(i.id), '[]'::jsonb) INTO v_subtree_items
    FROM public.package_items AS i
    WHERE i.package_id = p_package_id
      AND i.group_id IN (
        WITH RECURSIVE subtree AS (
          SELECT g.id FROM public.package_groups AS g
          WHERE g.id = p_group_id AND g.package_id = p_package_id
          UNION ALL
          SELECT g.id FROM public.package_groups AS g
          JOIN subtree AS s ON g.parent_group_id = s.id
          WHERE g.package_id = p_package_id
        )
        SELECT id FROM subtree
      );

    FOR v_event IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_events) AS e(value)
    LOOP
      IF v_event ->> 'type' IS DISTINCT FROM 'package.module.removed'
        OR NOT v_subtree_items @> pg_catalog.jsonb_build_array(v_event -> 'payload' ->> 'itemId') THEN
        RAISE EXCEPTION 'event.invalid';
      END IF;

      PERFORM public.insert_package_outbox_event(
        v_event, 'package.module.removed', p_package_id, p_user_id, p_correlation_id
      );
      v_event_count := v_event_count + 1;
    END LOOP;

    IF v_event_count <> pg_catalog.jsonb_array_length(v_subtree_items) THEN
      RAISE EXCEPTION 'event.invalid';
    END IF;

    -- No orphan: delete every item of the subtree, then the zone; the composite
    -- FK cascades to the descendant zones.
    DELETE FROM public.package_items AS i
    WHERE i.package_id = p_package_id
      AND i.group_id IN (
        WITH RECURSIVE subtree AS (
          SELECT g.id FROM public.package_groups AS g
          WHERE g.id = p_group_id AND g.package_id = p_package_id
          UNION ALL
          SELECT g.id FROM public.package_groups AS g
          JOIN subtree AS s ON g.parent_group_id = s.id
          WHERE g.package_id = p_package_id
        )
        SELECT id FROM subtree
      );

    DELETE FROM public.package_groups AS g
    WHERE g.id = p_group_id AND g.package_id = p_package_id;
  END IF;

  UPDATE public.packages AS p
  SET version = p.version + 1,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE p.id = p_package_id
  RETURNING p.version INTO v_version;

  RETURN pg_catalog.jsonb_build_object(
    'groupId', p_group_id,
    'strategy', p_strategy,
    'movedItemIds', CASE WHEN p_strategy = 'move_to_root' THEN v_direct_items ELSE '[]'::jsonb END,
    'removedItemIds', CASE WHEN p_strategy = 'delete_contents' THEN v_subtree_items ELSE '[]'::jsonb END,
    'eventCount', v_event_count,
    'packageVersion', v_version
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. move_package_item: relocate one instance, version +1
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.move_package_item(
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
  v_package_id uuid;
  v_user_id uuid;
  v_item_id uuid;
  v_module_id uuid;
BEGIN
  IF p_event ->> 'type' IS DISTINCT FROM 'package.module.moved' THEN
    RAISE EXCEPTION 'event.unsupported_type';
  END IF;

  IF p_event ->> 'packageId' IS NULL OR p_event ->> 'userId' IS NULL
    OR p_event -> 'payload' ->> 'itemId' IS NULL
    OR p_event -> 'payload' ->> 'moduleId' IS NULL THEN
    RAISE EXCEPTION 'event.invalid';
  END IF;

  v_package_id := (p_event ->> 'packageId')::uuid;
  v_user_id := (p_event ->> 'userId')::uuid;
  v_item_id := (p_event -> 'payload' ->> 'itemId')::uuid;
  v_module_id := (p_event -> 'payload' ->> 'moduleId')::uuid;

  SELECT p.version INTO v_version
  FROM public.packages AS p
  WHERE p.id = v_package_id AND p.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  IF p_expected_version IS NOT NULL AND v_version <> p_expected_version THEN
    RAISE EXCEPTION 'package.version_conflict';
  END IF;

  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.package_groups AS g
    WHERE g.id = p_group_id AND g.package_id = v_package_id
  ) THEN
    RAISE EXCEPTION 'package.group_not_found';
  END IF;

  UPDATE public.package_items AS i
  SET group_id = p_group_id
  WHERE i.id = v_item_id AND i.package_id = v_package_id AND i.module_id = v_module_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.item_not_found';
  END IF;

  PERFORM public.insert_package_outbox_event(
    p_event, 'package.module.moved', v_package_id, v_user_id, p_correlation_id
  );

  UPDATE public.packages AS p
  SET version = p.version + 1,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE p.id = v_package_id
  RETURNING p.version INTO v_version;

  RETURN v_version;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: service_role only, like every earlier RPC
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.set_package_group_depth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_package_outbox_event(jsonb, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_package_group(uuid, uuid, uuid, text, uuid, jsonb, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_package_group(uuid, uuid, uuid, text, uuid, boolean, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_package_group(uuid, uuid, uuid, text, jsonb, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_package_item(jsonb, uuid, integer, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.insert_package_outbox_event(jsonb, text, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_package_group(uuid, uuid, uuid, text, uuid, jsonb, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_package_group(uuid, uuid, uuid, text, uuid, boolean, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_package_group(uuid, uuid, uuid, text, jsonb, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.move_package_item(jsonb, uuid, integer, text)
  TO service_role;
