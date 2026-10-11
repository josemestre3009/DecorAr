-- Migration: decorative groups (Composite) with atomic RPCs
-- Requirement DECOR-25: Mei 4/6: implementar Composite para grupos decorativos
--
-- A group ("ModuloCompuesto", e.g. "Zona de bienvenida") belongs to one
-- package and may sit inside another group of the same package, up to three
-- levels. Leaves stay in public.package_items; group_id says which group
-- holds them (NULL = package root). Groups carry no price: the budget keeps
-- summing leaves (DECOR-33), so the event contract (DECOR-29) is unchanged.
--
-- Defense in the database (the domain validates first):
--   * depth is computed by trigger from the parent and limited to 1..3;
--   * a group's parent and package cannot change after insert, so a cycle
--     can never be formed (there is no "move group" operation);
--   * composite FKs keep parent groups and item groups in the same package.
-- Leaves are added through public.commit_package_change (DECOR-32), so each
-- one is versioned and stored in the outbox in the same transaction.

CREATE TABLE IF NOT EXISTS public.package_groups (
  id UUID PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES public.packages (id) ON DELETE CASCADE,
  parent_group_id UUID,
  name TEXT NOT NULL,
  depth INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_package_groups_id_package UNIQUE (id, package_id),
  CONSTRAINT fk_package_groups_parent FOREIGN KEY (parent_group_id, package_id)
    REFERENCES public.package_groups (id, package_id) ON DELETE CASCADE,
  CONSTRAINT chk_package_groups_not_own_parent CHECK (parent_group_id IS NULL OR parent_group_id <> id),
  CONSTRAINT chk_package_groups_depth CHECK (depth BETWEEN 1 AND 3),
  CONSTRAINT chk_package_groups_name CHECK (length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_package_groups_package_id ON public.package_groups (package_id);
CREATE INDEX IF NOT EXISTS idx_package_groups_parent_group_id ON public.package_groups (parent_group_id);

ALTER TABLE public.package_items ADD COLUMN IF NOT EXISTS group_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_package_items_group'
  ) THEN
    ALTER TABLE public.package_items
      ADD CONSTRAINT fk_package_items_group FOREIGN KEY (group_id, package_id)
      REFERENCES public.package_groups (id, package_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_package_items_group_id ON public.package_items (group_id);

-- Depth comes from the parent, never from the caller, and the tree position
-- is immutable: with no way to re-parent a group, no cycle can be created.
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
    IF NEW.package_id IS DISTINCT FROM OLD.package_id
      OR NEW.parent_group_id IS DISTINCT FROM OLD.parent_group_id THEN
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

DROP TRIGGER IF EXISTS trg_package_groups_depth ON public.package_groups;
CREATE TRIGGER trg_package_groups_depth
  BEFORE INSERT OR UPDATE ON public.package_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_package_group_depth();

-- Same model as package_items: the owner may read, nobody writes directly.
ALTER TABLE public.package_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.package_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.package_groups TO service_role;
GRANT SELECT ON TABLE public.package_groups TO authenticated;

DROP POLICY IF EXISTS "Owners can view groups of their packages" ON public.package_groups;
CREATE POLICY "Owners can view groups of their packages"
  ON public.package_groups
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.packages AS p
      WHERE p.id = package_groups.package_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

-- Creates a group and, optionally, its leaves in one transaction. Each leaf
-- is a package.module.added event committed through commit_package_change,
-- so a failing child rolls back the group, the other leaves and their
-- outbox rows. A group without leaves emits no event and keeps the version:
-- structural changes do not trigger a budget recalculation.
CREATE OR REPLACE FUNCTION public.create_package_group(
  p_package_id uuid,
  p_user_id uuid,
  p_group_id uuid,
  p_name text,
  p_parent_group_id uuid DEFAULT NULL,
  p_events jsonb DEFAULT '[]'::jsonb,
  p_expected_version integer DEFAULT NULL
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

    v_version := public.commit_package_change(v_event, NULL);

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
CREATE OR REPLACE FUNCTION public.add_package_item_to_group(
  p_event jsonb,
  p_group_id uuid,
  p_expected_version integer DEFAULT NULL
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

  v_version := public.commit_package_change(p_event, p_expected_version);

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

-- Prototype (DECOR-24) now also copies groups: new ids, same tree. Groups are
-- copied parents first (ordered by depth) and leaves keep their group through
-- the old -> new id map. Same signature, grants and error codes as before.
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
  v_groups_count integer := 0;
  v_group record;
  v_new_group_id uuid;
  v_group_map jsonb := '{}'::jsonb;
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

  -- Deep copy groups (DECOR-25): parents before children, new ids
  FOR v_group IN
    SELECT g.id, g.parent_group_id, g.name
    FROM public.package_groups AS g
    WHERE g.package_id = p_source_package_id
    ORDER BY g.depth, g.created_at, g.id
  LOOP
    v_new_group_id := pg_catalog.gen_random_uuid();
    v_group_map := v_group_map || pg_catalog.jsonb_build_object(v_group.id::text, v_new_group_id);

    INSERT INTO public.package_groups (id, package_id, parent_group_id, name, depth)
    VALUES (
      v_new_group_id,
      v_new_package_id,
      (v_group_map ->> v_group.parent_group_id::text)::uuid,
      v_group.name,
      1
    );

    v_groups_count := v_groups_count + 1;
  END LOOP;

  -- Deep copy mutable item instances: new item UUID, new package_id, same module_id,
  -- and the copied group of the original item (NULL stays at the root)
  INSERT INTO public.package_items (
    id,
    package_id,
    module_id,
    group_id,
    created_at
  )
  SELECT
    pg_catalog.gen_random_uuid(),
    v_new_package_id,
    pi.module_id,
    (v_group_map ->> pi.group_id::text)::uuid,
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
    'itemCount', v_items_count,
    'groupCount', v_groups_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_package_group_depth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_package_group(uuid, uuid, uuid, text, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_package_item_to_group(jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clone_package(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_package_group(uuid, uuid, uuid, text, uuid, jsonb, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.add_package_item_to_group(jsonb, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.clone_package(uuid, uuid) TO service_role;
