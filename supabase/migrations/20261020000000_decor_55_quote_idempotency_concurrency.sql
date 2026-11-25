-- Migration: idempotent quote creation and optimistic concurrency
-- Requirement DECOR-55: validar seguridad, concurrencia y recuperación V2
--
-- Additive to 20261019000000_create_quote_share_links.sql.
--
--   1. private.quote_idempotency_keys: ledger of `Idempotency-Key` values
--      used to create a quote or a quote version (same idea as
--      private.processed_events from DECOR-33). A retried request with the
--      same key and the same request fingerprint returns the quote it already
--      created instead of allocating another number or version; the same key
--      with a different fingerprint is rejected (`idempotency.key_reused`).
--      Rows live as long as the quote they point to (ON DELETE CASCADE).
--   2. create_quote / create_quote_version take `p_idempotency_key` and
--      `p_request_fingerprint`. The ledger is checked under the per-owner
--      counter lock, before the package-version and expected-version checks,
--      so a retry that lands after the first attempt committed is a replay,
--      never a conflict.
--   3. create_quote_version takes `p_expected_version` (the latest version
--      the caller saw) and raises `quote.version_conflict` with the current
--      version in DETAIL instead of silently superseding a newer version.
--   4. change_quote_status takes `p_expected_status`. A quote that is already
--      in the target status is a no-op success (a retried "mark as sent");
--      any other mismatch raises `quote.status_conflict` with the current
--      status in DETAIL.
--   5. save_package_scene no longer accepts a NULL `p_expected_version`: a
--      save without the version it read would overwrite a concurrent save.
--
-- The signatures change, so the old functions are dropped and the new ones
-- get the same privileges as before: SECURITY INVOKER, empty search_path,
-- EXECUTE for service_role only.

-- ---------------------------------------------------------------------------
-- 1. Idempotency ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.quote_idempotency_keys (
  owner_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  operation TEXT NOT NULL,
  -- sha256 of the canonical request built by the application; the request
  -- itself is not stored here.
  request_fingerprint BYTEA NOT NULL,
  quote_id UUID NOT NULL REFERENCES public.quotes (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT pk_quote_idempotency_keys PRIMARY KEY (owner_id, idempotency_key),
  CONSTRAINT chk_quote_idempotency_keys_operation
    CHECK (operation IN ('create_quote', 'create_quote_version'))
);

CREATE INDEX IF NOT EXISTS idx_quote_idempotency_keys_quote_id
  ON private.quote_idempotency_keys (quote_id);

ALTER TABLE private.quote_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.quote_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.quote_idempotency_keys TO service_role;

-- Returns the quote already created with this key (with `replayed: true`),
-- or NULL when the key is new. Must be called while holding the owner's
-- quote_counters row lock, which serializes every creation of that owner.
CREATE OR REPLACE FUNCTION private.replay_quote_idempotency_key(
  p_owner_id uuid,
  p_idempotency_key uuid,
  p_operation text,
  p_request_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_entry private.quote_idempotency_keys;
BEGIN
  SELECT * INTO v_entry
  FROM private.quote_idempotency_keys AS k
  WHERE k.owner_id = p_owner_id AND k.idempotency_key = p_idempotency_key;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_entry.operation IS DISTINCT FROM p_operation
     OR v_entry.request_fingerprint IS DISTINCT FROM
        pg_catalog.sha256(pg_catalog.convert_to(p_request_fingerprint, 'UTF8')) THEN
    RAISE EXCEPTION 'idempotency.key_reused';
  END IF;

  RETURN private.quote_json(v_entry.quote_id) || pg_catalog.jsonb_build_object('replayed', true);
END;
$$;

CREATE OR REPLACE FUNCTION private.record_quote_idempotency_key(
  p_owner_id uuid,
  p_idempotency_key uuid,
  p_operation text,
  p_request_fingerprint text,
  p_quote_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  INSERT INTO private.quote_idempotency_keys (
    owner_id, idempotency_key, operation, request_fingerprint, quote_id
  ) VALUES (
    p_owner_id,
    p_idempotency_key,
    p_operation,
    pg_catalog.sha256(pg_catalog.convert_to(p_request_fingerprint, 'UTF8')),
    p_quote_id
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. create_quote
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_quote(uuid, uuid, integer, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.create_quote(
  p_owner_id uuid,
  p_package_id uuid,
  p_expected_package_version integer,
  p_quote jsonb,
  p_lines jsonb,
  p_idempotency_key uuid,
  p_request_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_number integer;
  v_quote_id uuid;
  v_replay jsonb;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  IF p_idempotency_key IS NULL
     OR p_request_fingerprint IS NULL
     OR pg_catalog.length(p_request_fingerprint) = 0 THEN
    RAISE EXCEPTION 'idempotency.key_invalid';
  END IF;

  -- Lock the owner's counter row first (creating it if needed) so a retry
  -- running concurrently waits here and then sees the committed ledger row.
  INSERT INTO private.quote_counters AS c (owner_id, last_number)
  VALUES (p_owner_id, 0)
  ON CONFLICT (owner_id) DO NOTHING;

  PERFORM 1 FROM private.quote_counters AS c WHERE c.owner_id = p_owner_id FOR UPDATE;

  v_replay := private.replay_quote_idempotency_key(
    p_owner_id, p_idempotency_key, 'create_quote', p_request_fingerprint
  );
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  UPDATE private.quote_counters AS c
  SET last_number = c.last_number + 1
  WHERE c.owner_id = p_owner_id
  RETURNING c.last_number INTO v_number;

  v_quote_id := private.insert_quote_version(
    p_owner_id, p_package_id, p_expected_package_version, v_number, 1, p_quote, p_lines
  );

  PERFORM private.record_quote_idempotency_key(
    p_owner_id, p_idempotency_key, 'create_quote', p_request_fingerprint, v_quote_id
  );

  RETURN private.quote_json(v_quote_id) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. create_quote_version
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_quote_version(uuid, uuid, integer, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.create_quote_version(
  p_owner_id uuid,
  p_quote_id uuid,
  p_expected_package_version integer,
  p_quote jsonb,
  p_lines jsonb,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_request_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_number integer;
  v_package_id uuid;
  v_current integer;
  v_quote_id uuid;
  v_replay jsonb;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  IF p_idempotency_key IS NULL
     OR p_request_fingerprint IS NULL
     OR pg_catalog.length(p_request_fingerprint) = 0 THEN
    RAISE EXCEPTION 'idempotency.key_invalid';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'quote.invalid_body';
  END IF;

  SELECT q.quote_number, q.package_id INTO v_number, v_package_id
  FROM public.quotes AS q
  WHERE q.id = p_quote_id AND q.owner_id = p_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote.not_found';
  END IF;

  -- Serializes version allocation per owner, like number allocation.
  INSERT INTO private.quote_counters AS c (owner_id, last_number)
  VALUES (p_owner_id, 0)
  ON CONFLICT (owner_id) DO NOTHING;

  PERFORM 1 FROM private.quote_counters AS c WHERE c.owner_id = p_owner_id FOR UPDATE;

  v_replay := private.replay_quote_idempotency_key(
    p_owner_id, p_idempotency_key, 'create_quote_version', p_request_fingerprint
  );
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'quote.package_missing';
  END IF;

  SELECT pg_catalog.max(q.version) INTO v_current
  FROM public.quotes AS q
  WHERE q.owner_id = p_owner_id AND q.quote_number = v_number;

  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'quote.version_conflict'
      USING DETAIL = v_current::text;
  END IF;

  v_quote_id := private.insert_quote_version(
    p_owner_id, v_package_id, p_expected_package_version, v_number, v_current + 1, p_quote, p_lines
  );

  PERFORM private.record_quote_idempotency_key(
    p_owner_id, p_idempotency_key, 'create_quote_version', p_request_fingerprint, v_quote_id
  );

  RETURN private.quote_json(v_quote_id) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. change_quote_status
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.change_quote_status(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.change_quote_status(
  p_owner_id uuid,
  p_quote_id uuid,
  p_status text,
  p_expected_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('draft', 'sent', 'accepted', 'expired') THEN
    RAISE EXCEPTION 'quote.invalid_status';
  END IF;

  IF p_expected_status IS NULL OR p_expected_status NOT IN ('draft', 'sent', 'accepted', 'expired') THEN
    RAISE EXCEPTION 'quote.invalid_status';
  END IF;

  SELECT q.status INTO v_current
  FROM public.quotes AS q
  WHERE q.id = p_quote_id AND q.owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote.not_found';
  END IF;

  -- A retry of a change that already happened: nothing to do.
  IF v_current = p_status THEN
    RETURN private.quote_json(p_quote_id);
  END IF;

  IF v_current <> p_expected_status THEN
    RAISE EXCEPTION 'quote.status_conflict'
      USING DETAIL = v_current;
  END IF;

  UPDATE public.quotes AS q
  SET status = p_status
  WHERE q.id = p_quote_id AND q.owner_id = p_owner_id;

  RETURN private.quote_json(p_quote_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. save_package_scene: expected version is mandatory
-- ---------------------------------------------------------------------------

-- A parameter default cannot be removed with CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.save_package_scene(uuid, uuid, jsonb, integer);

CREATE OR REPLACE FUNCTION public.save_package_scene(
  p_package_id uuid,
  p_user_id uuid,
  p_transforms jsonb,
  p_expected_version integer
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

  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
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

  IF v_version <> p_expected_version THEN
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

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.replay_quote_idempotency_key(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.record_quote_idempotency_key(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_quote(uuid, uuid, integer, jsonb, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_quote_version(uuid, uuid, integer, jsonb, jsonb, integer, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.change_quote_status(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_package_scene(uuid, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.replay_quote_idempotency_key(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.record_quote_idempotency_key(uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_quote(uuid, uuid, integer, jsonb, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_quote_version(uuid, uuid, integer, jsonb, jsonb, integer, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.change_quote_status(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_package_scene(uuid, uuid, jsonb, integer) TO service_role;
