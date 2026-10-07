-- Migration: transactional outbox for domain events
-- Requirement DECOR-32: persistencia de eventos y publicación posterior
--
-- The outbox lives in the `private` schema, which PostgREST does not expose.
-- Only `service_role` (server-only) can touch it. Every function is
-- SECURITY INVOKER with an empty search_path and fully qualified names.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

-- Minimal package aggregate required by the atomic RPC. DECOR-27 extends it
-- (space type, capacity, groups) with additive migrations.
CREATE TABLE IF NOT EXISTS public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chk_packages_version_positive CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_packages_user_id ON public.packages (user_id);

CREATE TABLE IF NOT EXISTS public.package_items (
  id UUID PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES public.packages (id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES public.catalog_modules (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_package_items_package_id ON public.package_items (package_id);

-- Deny-all until DECOR-30 defines per-user policies; writes go through the RPC.
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.packages, public.package_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.packages, public.package_items TO service_role;

CREATE TABLE IF NOT EXISTS private.domain_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  package_id UUID NOT NULL,
  user_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  event JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT uq_domain_events_event_id UNIQUE (event_id),
  CONSTRAINT chk_domain_events_event_id_non_empty CHECK (length(trim(event_id)) > 0),
  CONSTRAINT chk_domain_events_status CHECK (status IN ('pending', 'published')),
  CONSTRAINT chk_domain_events_attempts_non_negative CHECK (attempts >= 0),
  CONSTRAINT chk_domain_events_published_at CHECK ((status = 'published') = (published_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_domain_events_pending
  ON private.domain_events (id)
  WHERE status = 'pending';

ALTER TABLE private.domain_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.domain_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE private.domain_events TO service_role;

-- Applies the package change described by a package.module.added/removed
-- event and stores the event in the outbox, in one transaction.
-- Returns the new package version (the HTTP `packageVersion`).
CREATE OR REPLACE FUNCTION public.commit_package_change(
  p_event jsonb,
  p_expected_version integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_type text := p_event ->> 'type';
  v_event_id text := p_event ->> 'eventId';
  v_user_id text := p_event ->> 'userId';
  v_package_id text := p_event ->> 'packageId';
  v_item_id text := p_event -> 'payload' ->> 'itemId';
  v_module_id text := p_event -> 'payload' ->> 'moduleId';
  v_version integer;
BEGIN
  IF p_event -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN
    RAISE EXCEPTION 'event.unsupported_version';
  END IF;

  IF v_type IS NULL OR v_type NOT IN ('package.module.added', 'package.module.removed') THEN
    RAISE EXCEPTION 'event.unsupported_type';
  END IF;

  IF v_event_id IS NULL OR pg_catalog.length(pg_catalog.btrim(v_event_id)) = 0
    OR v_user_id IS NULL OR v_user_id !~ v_uuid
    OR v_package_id IS NULL OR v_package_id !~ v_uuid
    OR v_item_id IS NULL OR v_item_id !~ v_uuid
    OR v_module_id IS NULL OR v_module_id !~ v_uuid
    OR p_event ->> 'occurredAt' IS NULL THEN
    RAISE EXCEPTION 'event.invalid';
  END IF;

  SELECT p.version INTO v_version
  FROM public.packages AS p
  WHERE p.id = v_package_id::uuid AND p.user_id = v_user_id::uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  IF p_expected_version IS NOT NULL AND v_version <> p_expected_version THEN
    RAISE EXCEPTION 'package.version_conflict';
  END IF;

  IF v_type = 'package.module.added' THEN
    INSERT INTO public.package_items (id, package_id, module_id)
    VALUES (v_item_id::uuid, v_package_id::uuid, v_module_id::uuid);
  ELSE
    DELETE FROM public.package_items AS i
    WHERE i.id = v_item_id::uuid
      AND i.package_id = v_package_id::uuid
      AND i.module_id = v_module_id::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'package.item_not_found';
    END IF;
  END IF;

  UPDATE public.packages AS p
  SET version = p.version + 1,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE p.id = v_package_id::uuid
  RETURNING p.version INTO v_version;

  BEGIN
    INSERT INTO private.domain_events (event_id, event_type, package_id, user_id, occurred_at, event)
    VALUES (
      v_event_id,
      v_type,
      v_package_id::uuid,
      v_user_id::uuid,
      (p_event ->> 'occurredAt')::timestamptz,
      p_event
    );
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'event.duplicate';
  END;

  RETURN v_version;
END;
$$;

-- Initial delivery attempt only. Claims pending events that were never
-- attempted and records the attempt in the same statement, so a concurrent
-- or later drainer can never claim them again. Retries belong to DECOR-31.
CREATE OR REPLACE FUNCTION public.claim_initial_domain_events(p_limit integer DEFAULT 50)
RETURNS TABLE (event_id text, event jsonb)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT d.id
    FROM private.domain_events AS d
    WHERE d.status = 'pending' AND d.attempts = 0
    ORDER BY d.id
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 500)
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE private.domain_events AS d
    SET attempts = d.attempts + 1,
        last_attempt_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
    FROM candidates AS c
    WHERE d.id = c.id
    RETURNING d.id, d.event_id, d.event
  )
  SELECT claimed.event_id, claimed.event
  FROM claimed
  ORDER BY claimed.id;
$$;

CREATE OR REPLACE FUNCTION public.mark_domain_event_published(p_event_id text)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH updated AS (
    UPDATE private.domain_events AS d
    SET status = 'published',
        published_at = pg_catalog.timezone('utc'::text, pg_catalog.now()),
        last_error = NULL
    WHERE d.event_id = p_event_id AND d.status = 'pending'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

CREATE OR REPLACE FUNCTION public.record_domain_event_failure(p_event_id text, p_error text)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH updated AS (
    UPDATE private.domain_events AS d
    SET last_error = pg_catalog.left(coalesce(p_error, 'unknown error'), 1000)
    WHERE d.event_id = p_event_id AND d.status = 'pending'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

REVOKE ALL ON FUNCTION public.commit_package_change(jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_initial_domain_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_domain_event_published(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_domain_event_failure(text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.commit_package_change(jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_initial_domain_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_domain_event_published(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_domain_event_failure(text, text) TO service_role;
