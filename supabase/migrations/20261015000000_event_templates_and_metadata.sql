-- Migration: event metadata on public.packages and private event templates
-- Requirement DECOR-44: eventos con metadatos opcionales y plantillas privadas
--
-- Additive to 20261014000000_add_package_items_batch.sql.
--
--   1. public.packages gains a required `name` (deterministic backfill for
--      legacy rows and for inserts that still omit it), optional client/date/
--      venue/event-type metadata, and nullable space_type/capacity_m2 whose
--      existing CHECK constraints keep rejecting invalid non-null values.
--   2. public.create_package now requires a name and accepts the optional
--      metadata; public.clone_package keeps its signature and copies the new
--      columns, so the existing Prototype clone stays functional.
--   3. Normalized private templates: public.event_templates,
--      public.event_template_groups and public.event_template_items. Owner
--      SELECT only through RLS; no anon/authenticated writes; service_role
--      performs every mutation through the atomic RPCs.
--
-- Every function is SECURITY INVOKER with an empty search_path and fully
-- qualified names, executable only by service_role, following the convention
-- of the earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. packages: name and optional metadata
-- ---------------------------------------------------------------------------

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS event_date DATE,
  ADD COLUMN IF NOT EXISTS venue TEXT,
  ADD COLUMN IF NOT EXISTS event_type TEXT;

-- Deterministic, readable name for legacy rows. Guarded with IS NULL so
-- re-evaluating the migration never rewrites an existing name.
UPDATE public.packages AS p
SET name = 'Evento ' || pg_catalog.substr(p.id::text, 1, 8)
WHERE p.name IS NULL OR pg_catalog.length(pg_catalog.btrim(p.name)) = 0;

-- Legacy callers (direct SQL, pre-change RPCs) that omit the name get the same
-- deterministic value, so the NOT NULL constraint below never rejects a row.
CREATE OR REPLACE FUNCTION public.set_default_package_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := pg_catalog.gen_random_uuid();
  END IF;

  IF NEW.name IS NULL OR pg_catalog.length(pg_catalog.btrim(NEW.name)) = 0 THEN
    NEW.name := 'Evento ' || pg_catalog.substr(NEW.id::text, 1, 8);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_packages_default_name ON public.packages;
CREATE TRIGGER trg_packages_default_name
  BEFORE INSERT ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.set_default_package_name();

ALTER TABLE public.packages ALTER COLUMN name SET NOT NULL;

-- Space type and capacity become optional. Their existing CHECK constraints
-- (`chk_packages_space_type`, `chk_packages_capacity_positive`) are kept: NULL
-- passes them, any non-null value must still be valid.
ALTER TABLE public.packages ALTER COLUMN space_type DROP NOT NULL;
ALTER TABLE public.packages ALTER COLUMN capacity_m2 DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_packages_name' AND conrelid = 'public.packages'::regclass
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT chk_packages_name
      CHECK (pg_catalog.length(pg_catalog.btrim(name)) BETWEEN 1 AND 120);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_packages_client_name_length' AND conrelid = 'public.packages'::regclass
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT chk_packages_client_name_length
      CHECK (client_name IS NULL OR pg_catalog.length(pg_catalog.btrim(client_name)) <= 120);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_packages_venue_length' AND conrelid = 'public.packages'::regclass
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT chk_packages_venue_length
      CHECK (venue IS NULL OR pg_catalog.length(pg_catalog.btrim(venue)) <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'chk_packages_event_type_length' AND conrelid = 'public.packages'::regclass
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT chk_packages_event_type_length
      CHECK (event_type IS NULL OR pg_catalog.length(pg_catalog.btrim(event_type)) <= 80);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. create_package (name required) and clone_package (unchanged signature)
-- ---------------------------------------------------------------------------

-- The previous three-parameter signature cannot express a name, so it is
-- replaced instead of overloaded. No concrete test executes it; the current
-- repository is updated in the application slice of DECOR-44.
DROP FUNCTION IF EXISTS public.create_package(uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.create_package(
  p_user_id uuid,
  p_name text,
  p_space_type text DEFAULT NULL,
  p_capacity_m2 numeric DEFAULT NULL,
  p_client_name text DEFAULT NULL,
  p_event_date date DEFAULT NULL,
  p_venue text DEFAULT NULL,
  p_event_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_user';
  END IF;

  IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'package.invalid_name';
  END IF;

  IF p_space_type IS NOT NULL AND p_space_type NOT IN ('casa', 'aireLibre', 'salonSocial') THEN
    RAISE EXCEPTION 'package.invalid_space_type';
  END IF;

  IF p_capacity_m2 IS NOT NULL AND p_capacity_m2 <= 0 THEN
    RAISE EXCEPTION 'package.invalid_capacity';
  END IF;

  v_name := pg_catalog.btrim(p_name);

  INSERT INTO public.packages (
    user_id, name, space_type, capacity_m2, client_name, event_date, venue, event_type, version
  ) VALUES (
    p_user_id, v_name, p_space_type, p_capacity_m2, p_client_name, p_event_date, p_venue, p_event_type, 1
  )
  RETURNING id INTO v_id;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_id,
    'name', v_name,
    'spaceType', p_space_type,
    'capacityM2', p_capacity_m2,
    'clientName', p_client_name,
    'eventDate', p_event_date,
    'venue', p_venue,
    'eventType', p_event_type
  );
END;
$$;

-- Prototype clone stays functional now that name is NOT NULL and the spatial
-- fields are optional: it copies the new columns and keeps emitting the fields
-- the existing readers map.
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

  SELECT * INTO v_source
  FROM public.packages
  WHERE id = p_source_package_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  v_new_package_id := pg_catalog.gen_random_uuid();

  INSERT INTO public.packages (
    id,
    user_id,
    name,
    space_type,
    capacity_m2,
    client_name,
    event_date,
    venue,
    event_type,
    style,
    colors,
    notes,
    version,
    created_at,
    updated_at
  ) VALUES (
    v_new_package_id,
    p_target_user_id,
    v_source.name,
    v_source.space_type,
    v_source.capacity_m2,
    v_source.client_name,
    v_source.event_date,
    v_source.venue,
    v_source.event_type,
    v_source.style,
    coalesce(v_source.colors, '[]'::jsonb),
    coalesce(v_source.notes, ''),
    1,
    pg_catalog.timezone('utc'::text, pg_catalog.now()),
    pg_catalog.timezone('utc'::text, pg_catalog.now())
  );

  -- Deep copy groups (parents before children, new ids).
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

  -- Deep copy item instances: new item id, same catalog module, copied group.
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
    'name', v_source.name,
    'spaceType', v_source.space_type,
    'capacityM2', v_source.capacity_m2,
    'clientName', v_source.client_name,
    'eventDate', v_source.event_date,
    'venue', v_source.venue,
    'eventType', v_source.event_type,
    'style', v_source.style,
    'colors', coalesce(v_source.colors, '[]'::jsonb),
    'notes', coalesce(v_source.notes, ''),
    'version', 1,
    'itemCount', v_items_count,
    'groupCount', v_groups_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_package(uuid, text, text, numeric, text, date, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clone_package(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_default_package_name() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_package(uuid, text, text, numeric, text, date, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.clone_package(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Normalized private templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  space_type TEXT,
  capacity_m2 NUMERIC(8, 2),
  event_type TEXT,
  style TEXT,
  colors JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chk_event_templates_name CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT chk_event_templates_space_type
    CHECK (space_type IS NULL OR space_type IN ('casa', 'aireLibre', 'salonSocial')),
  CONSTRAINT chk_event_templates_capacity_positive CHECK (capacity_m2 IS NULL OR capacity_m2 > 0),
  CONSTRAINT chk_event_templates_event_type_length
    CHECK (event_type IS NULL OR length(btrim(event_type)) <= 80)
);

CREATE INDEX IF NOT EXISTS idx_event_templates_owner_id ON public.event_templates (owner_id);

CREATE TABLE IF NOT EXISTS public.event_template_groups (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.event_templates (id) ON DELETE CASCADE,
  parent_group_id UUID,
  name TEXT NOT NULL,
  depth INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT uq_event_template_groups_id_template UNIQUE (id, template_id),
  CONSTRAINT fk_event_template_groups_parent FOREIGN KEY (parent_group_id, template_id)
    REFERENCES public.event_template_groups (id, template_id) ON DELETE CASCADE,
  CONSTRAINT chk_event_template_groups_not_own_parent
    CHECK (parent_group_id IS NULL OR parent_group_id <> id),
  CONSTRAINT chk_event_template_groups_depth CHECK (depth BETWEEN 1 AND 3),
  CONSTRAINT chk_event_template_groups_name CHECK (length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_event_template_groups_template_id
  ON public.event_template_groups (template_id);
CREATE INDEX IF NOT EXISTS idx_event_template_groups_parent_group_id
  ON public.event_template_groups (parent_group_id);

CREATE TABLE IF NOT EXISTS public.event_template_items (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.event_templates (id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES public.catalog_modules (id),
  group_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT fk_event_template_items_group FOREIGN KEY (group_id, template_id)
    REFERENCES public.event_template_groups (id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_event_template_items_template_id
  ON public.event_template_items (template_id);
CREATE INDEX IF NOT EXISTS idx_event_template_items_group_id
  ON public.event_template_items (group_id);

-- Same guard as Composite groups: depth derives from the parent, capped at 3,
-- and the tree position is immutable so no cycle can be formed.
CREATE OR REPLACE FUNCTION public.set_event_template_group_depth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_parent_depth integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.template_id IS DISTINCT FROM OLD.template_id
      OR NEW.parent_group_id IS DISTINCT FROM OLD.parent_group_id THEN
      RAISE EXCEPTION 'template.group_immutable';
    END IF;
    NEW.depth := OLD.depth;
    RETURN NEW;
  END IF;

  IF NEW.parent_group_id IS NULL THEN
    NEW.depth := 1;
    RETURN NEW;
  END IF;

  SELECT g.depth INTO v_parent_depth
  FROM public.event_template_groups AS g
  WHERE g.id = NEW.parent_group_id AND g.template_id = NEW.template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template.group_not_found';
  END IF;

  IF v_parent_depth + 1 > 3 THEN
    RAISE EXCEPTION 'template.group_depth_exceeded';
  END IF;

  NEW.depth := v_parent_depth + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_template_groups_depth ON public.event_template_groups;
CREATE TRIGGER trg_event_template_groups_depth
  BEFORE INSERT OR UPDATE ON public.event_template_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_event_template_group_depth();

-- Owner reads through RLS; nobody writes directly. service_role bypasses RLS
-- and is the only role that mutates, always through the RPCs below.
ALTER TABLE public.event_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_template_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_template_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_templates, public.event_template_groups, public.event_template_items
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.event_templates, public.event_template_groups, public.event_template_items TO service_role;
GRANT SELECT ON TABLE
  public.event_templates, public.event_template_groups, public.event_template_items TO authenticated;

DROP POLICY IF EXISTS "Owners can view their event templates" ON public.event_templates;
CREATE POLICY "Owners can view their event templates"
  ON public.event_templates
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Owners can view groups of their event templates" ON public.event_template_groups;
CREATE POLICY "Owners can view groups of their event templates"
  ON public.event_template_groups
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_templates AS t
      WHERE t.id = event_template_groups.template_id
        AND t.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners can view items of their event templates" ON public.event_template_items;
CREATE POLICY "Owners can view items of their event templates"
  ON public.event_template_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_templates AS t
      WHERE t.id = event_template_items.template_id
        AND t.owner_id = (SELECT auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Atomic copies between events and templates
-- ---------------------------------------------------------------------------

-- event -> template: locks the source event, verifies ownership inside the
-- transaction, copies modules, groups (hierarchy) and preferences with new
-- UUIDs. Client, date and venue are deliberately never copied: the template
-- tables have no such columns.
CREATE OR REPLACE FUNCTION public.create_event_template_from_package(
  p_source_package_id uuid,
  p_owner_id uuid,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source public.packages%ROWTYPE;
  v_template_id uuid;
  v_name text;
  v_group record;
  v_new_group_id uuid;
  v_group_map jsonb := '{}'::jsonb;
  v_items_count integer := 0;
  v_groups_count integer := 0;
BEGIN
  IF p_source_package_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_source';
  END IF;

  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_user';
  END IF;

  IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'template.invalid_name';
  END IF;

  SELECT * INTO v_source
  FROM public.packages
  WHERE id = p_source_package_id AND user_id = p_owner_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  v_template_id := pg_catalog.gen_random_uuid();
  v_name := pg_catalog.btrim(p_name);

  INSERT INTO public.event_templates (
    id, owner_id, name, space_type, capacity_m2, event_type, style, colors, notes
  ) VALUES (
    v_template_id,
    p_owner_id,
    v_name,
    v_source.space_type,
    v_source.capacity_m2,
    v_source.event_type,
    v_source.style,
    coalesce(v_source.colors, '[]'::jsonb),
    coalesce(v_source.notes, '')
  );

  FOR v_group IN
    SELECT g.id, g.parent_group_id, g.name
    FROM public.package_groups AS g
    WHERE g.package_id = p_source_package_id
    ORDER BY g.depth, g.created_at, g.id
  LOOP
    v_new_group_id := pg_catalog.gen_random_uuid();
    v_group_map := v_group_map || pg_catalog.jsonb_build_object(v_group.id::text, v_new_group_id);

    INSERT INTO public.event_template_groups (id, template_id, parent_group_id, name, depth)
    VALUES (
      v_new_group_id,
      v_template_id,
      (v_group_map ->> v_group.parent_group_id::text)::uuid,
      v_group.name,
      1
    );

    v_groups_count := v_groups_count + 1;
  END LOOP;

  INSERT INTO public.event_template_items (id, template_id, module_id, group_id)
  SELECT
    pg_catalog.gen_random_uuid(),
    v_template_id,
    pi.module_id,
    (v_group_map ->> pi.group_id::text)::uuid
  FROM public.package_items AS pi
  WHERE pi.package_id = p_source_package_id;

  GET DIAGNOSTICS v_items_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_template_id,
    'name', v_name,
    'spaceType', v_source.space_type,
    'capacityM2', v_source.capacity_m2,
    'eventType', v_source.event_type,
    'style', v_source.style,
    'colors', coalesce(v_source.colors, '[]'::jsonb),
    'notes', coalesce(v_source.notes, ''),
    'itemCount', v_items_count,
    'groupCount', v_groups_count
  );
END;
$$;

-- template -> event: locks the template, verifies ownership inside the
-- transaction, creates a fresh event with client/date/venue absent and copies
-- modules, groups and preferences with new UUIDs.
CREATE OR REPLACE FUNCTION public.create_package_from_event_template(
  p_template_id uuid,
  p_owner_id uuid,
  p_event_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_template public.event_templates%ROWTYPE;
  v_package_id uuid;
  v_name text;
  v_group record;
  v_new_group_id uuid;
  v_group_map jsonb := '{}'::jsonb;
  v_items_count integer := 0;
  v_groups_count integer := 0;
BEGIN
  IF p_template_id IS NULL THEN
    RAISE EXCEPTION 'template.invalid_source';
  END IF;

  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'package.invalid_user';
  END IF;

  IF p_event_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_event_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'package.invalid_name';
  END IF;

  SELECT * INTO v_template
  FROM public.event_templates
  WHERE id = p_template_id AND owner_id = p_owner_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template.not_found';
  END IF;

  v_package_id := pg_catalog.gen_random_uuid();
  v_name := pg_catalog.btrim(p_event_name);

  INSERT INTO public.packages (
    id, user_id, name, space_type, capacity_m2, event_type, style, colors, notes,
    client_name, event_date, venue, version
  ) VALUES (
    v_package_id,
    p_owner_id,
    v_name,
    v_template.space_type,
    v_template.capacity_m2,
    v_template.event_type,
    v_template.style,
    coalesce(v_template.colors, '[]'::jsonb),
    coalesce(v_template.notes, ''),
    NULL,
    NULL,
    NULL,
    1
  );

  FOR v_group IN
    SELECT g.id, g.parent_group_id, g.name
    FROM public.event_template_groups AS g
    WHERE g.template_id = p_template_id
    ORDER BY g.depth, g.created_at, g.id
  LOOP
    v_new_group_id := pg_catalog.gen_random_uuid();
    v_group_map := v_group_map || pg_catalog.jsonb_build_object(v_group.id::text, v_new_group_id);

    INSERT INTO public.package_groups (id, package_id, parent_group_id, name, depth)
    VALUES (
      v_new_group_id,
      v_package_id,
      (v_group_map ->> v_group.parent_group_id::text)::uuid,
      v_group.name,
      1
    );

    v_groups_count := v_groups_count + 1;
  END LOOP;

  INSERT INTO public.package_items (id, package_id, module_id, group_id)
  SELECT
    pg_catalog.gen_random_uuid(),
    v_package_id,
    ti.module_id,
    (v_group_map ->> ti.group_id::text)::uuid
  FROM public.event_template_items AS ti
  WHERE ti.template_id = p_template_id;

  GET DIAGNOSTICS v_items_count = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_package_id,
    'name', v_name,
    'spaceType', v_template.space_type,
    'capacityM2', v_template.capacity_m2,
    'eventType', v_template.event_type,
    'style', v_template.style,
    'colors', coalesce(v_template.colors, '[]'::jsonb),
    'notes', coalesce(v_template.notes, ''),
    'clientName', NULL,
    'eventDate', NULL,
    'venue', NULL,
    'version', 1,
    'itemCount', v_items_count,
    'groupCount', v_groups_count
  );
END;
$$;

-- Owner-scoped rename and delete. Both verify ownership inside the statement,
-- so a foreign or missing template reports the same `template.not_found`.
CREATE OR REPLACE FUNCTION public.rename_event_template(
  p_template_id uuid,
  p_owner_id uuid,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row public.event_templates%ROWTYPE;
BEGIN
  IF p_template_id IS NULL OR p_owner_id IS NULL THEN
    RAISE EXCEPTION 'template.not_found';
  END IF;

  IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'template.invalid_name';
  END IF;

  UPDATE public.event_templates AS t
  SET name = pg_catalog.btrim(p_name),
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE t.id = p_template_id AND t.owner_id = p_owner_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template.not_found';
  END IF;

  RETURN pg_catalog.jsonb_build_object('id', v_row.id, 'name', v_row.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_event_template(
  p_template_id uuid,
  p_owner_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_template_id IS NULL OR p_owner_id IS NULL THEN
    RAISE EXCEPTION 'template.not_found';
  END IF;

  DELETE FROM public.event_templates AS t
  WHERE t.id = p_template_id AND t.owner_id = p_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template.not_found';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_event_template_group_depth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_event_template_from_package(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_package_from_event_template(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rename_event_template(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_event_template(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_event_template_from_package(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_package_from_event_template(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rename_event_template(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_event_template(uuid, uuid) TO service_role;
