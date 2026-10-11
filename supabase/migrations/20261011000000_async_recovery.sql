-- Migration: retries, failed state, reconciliation and correlationId
-- Requirement DECOR-31: recuperación observable de fallos asíncronos
--
-- Additive to `supabase/migrations/20261007000000_create_event_outbox.sql`
-- (DECOR-32) and `supabase/migrations/20261008010000_create_idempotent_budget_consumer.sql`
-- (DECOR-33). Does not change `commit_package_change`'s existing signature
-- behaviour, `claim_initial_domain_events`, or `process_budget_event`. Every
-- new function is SECURITY INVOKER with an empty search_path and fully
-- qualified names, executable only by `service_role`, following the same
-- convention as the two migrations above.

-- `correlation_id` is metadata of the outbox row, not part of the versioned
-- event contract (DECOR-29's schemaVersion 1 is unchanged). Nullable so every
-- existing row and every caller that does not pass it keeps working.
ALTER TABLE private.domain_events
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- `failed` marks an event that exhausted its three retries: distinct from
-- `pending` (never attempted or mid-retry) so `list_retryable_domain_events`
-- and reconciliation can each select the rows they care about without
-- repeating an `attempts` threshold everywhere.
ALTER TABLE private.domain_events
  DROP CONSTRAINT IF EXISTS chk_domain_events_status;

ALTER TABLE private.domain_events
  ADD CONSTRAINT chk_domain_events_status CHECK (status IN ('pending', 'published', 'failed'));

CREATE INDEX IF NOT EXISTS idx_domain_events_retryable
  ON private.domain_events (id)
  WHERE status = 'pending' AND attempts >= 1 AND attempts <= 3;

CREATE INDEX IF NOT EXISTS idx_domain_events_failed
  ON private.domain_events (id)
  WHERE status = 'failed';

-- `CREATE OR REPLACE FUNCTION` with a different parameter count creates a
-- new overload instead of replacing the DECOR-32 function, which would leave
-- two `commit_package_change` signatures resolvable by callers. Drop the
-- two-parameter version first so only the three-parameter one remains; the
-- new parameter defaults to NULL, so every existing call site keeps working
-- unchanged.
DROP FUNCTION IF EXISTS public.commit_package_change(jsonb, integer);

CREATE FUNCTION public.commit_package_change(
  p_event jsonb,
  p_expected_version integer DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
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

  -- A repeated eventId short-circuits here, before any package
  -- mutation, so an exact replay reports `event.duplicate` instead of a
  -- misleading `package.version_conflict`, `package.item_not_found` or
  -- persistence error. The unique constraint below still covers races.
  IF EXISTS (
    SELECT 1 FROM private.domain_events AS d WHERE d.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'event.duplicate';
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
    INSERT INTO private.domain_events (event_id, event_type, package_id, user_id, occurred_at, event, correlation_id)
    VALUES (
      v_event_id,
      v_type,
      v_package_id::uuid,
      v_user_id::uuid,
      (p_event ->> 'occurredAt')::timestamptz,
      p_event,
      p_correlation_id
    );
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'event.duplicate';
  END;

  RETURN v_version;
END;
$$;

-- Retry reclaim: increments `attempts` and records the attempt only if the
-- row is still `pending` with exactly the expected `attempts`, so two
-- concurrent retries of the same event and the same retry number never both
-- succeed (the second finds `attempts` already moved and reclaims nothing).
-- Returns the event body and its correlationId so the caller can republish
-- and log without a second round-trip.
CREATE OR REPLACE FUNCTION public.claim_retry_domain_event(
  p_event_id text,
  p_expected_attempts integer
)
RETURNS TABLE (event_id text, event jsonb, attempts integer, correlation_id text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH claimed AS (
    UPDATE private.domain_events AS d
    SET attempts = d.attempts + 1,
        last_attempt_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
    WHERE d.event_id = p_event_id
      AND d.status = 'pending'
      AND d.attempts = p_expected_attempts
    RETURNING d.event_id, d.event, d.attempts, d.correlation_id
  )
  SELECT claimed.event_id, claimed.event, claimed.attempts, claimed.correlation_id
  FROM claimed;
$$;

-- Lists events still eligible for a bounded retry: pending with between one
-- and three prior attempts. An event with zero attempts belongs to the
-- initial drain (DECOR-32); one with four or more is `failed` and excluded.
CREATE OR REPLACE FUNCTION public.list_retryable_domain_events(p_limit integer DEFAULT 50)
RETURNS TABLE (event_id text, event jsonb, attempts integer, last_attempt_at timestamptz, correlation_id text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT d.event_id, d.event, d.attempts, d.last_attempt_at, d.correlation_id
  FROM private.domain_events AS d
  WHERE d.status = 'pending' AND d.attempts BETWEEN 1 AND 3
  ORDER BY d.id
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

-- Terminal failure after the third retry: moves the event to `failed` so it
-- stops being retried and becomes visible for reconciliation. Refuses to
-- mark a published event as failed (defensive: should never be reachable).
CREATE OR REPLACE FUNCTION public.mark_domain_event_failed(p_event_id text, p_error text)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH updated AS (
    UPDATE private.domain_events AS d
    SET status = 'failed',
        last_error = pg_catalog.left(coalesce(p_error, 'unknown error'), 1000)
    WHERE d.event_id = p_event_id AND d.status = 'pending' AND d.published_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

-- Lists pending and failed events for the recovery endpoint. Read-only,
-- deliberately separate from `list_retryable_domain_events` because it also
-- surfaces never-attempted and exhausted events for visibility.
CREATE OR REPLACE FUNCTION public.list_unresolved_domain_events(p_limit integer DEFAULT 100)
RETURNS TABLE (
  event_id text,
  status text,
  attempts integer,
  last_attempt_at timestamptz,
  last_error text,
  correlation_id text,
  package_id uuid
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT d.event_id, d.status, d.attempts, d.last_attempt_at, d.last_error, d.correlation_id, d.package_id
  FROM private.domain_events AS d
  WHERE d.status IN ('pending', 'failed')
  ORDER BY d.id
  LIMIT least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- Reconciles `public.budgets` against a freshly recalculated total. Unlike
-- `process_budget_event` (DECOR-33), which requires a brand-new eventId and
-- a strictly newer packageVersion, this corrects a drift for the *same*
-- packageVersion too: applies when there is no row yet, when
-- `p_package_version` is newer than stored, or when it is equal but the
-- stored total differs from the recalculated one. A second call with the
-- same already-correct values reports `corrected = false`.
CREATE OR REPLACE FUNCTION public.reconcile_budget(
  p_package_id uuid,
  p_package_version integer,
  p_total_cop bigint
)
RETURNS TABLE (
  corrected boolean,
  package_id uuid,
  total_cop bigint,
  package_version integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_corrected boolean := false;
BEGIN
  IF p_package_version IS NULL OR p_package_version <= 0 THEN
    RAISE EXCEPTION 'package.invalid_version';
  END IF;

  IF p_total_cop IS NULL OR p_total_cop < 0 THEN
    RAISE EXCEPTION 'budget.invalid_total';
  END IF;

  UPDATE public.budgets AS b
  SET total_cop = p_total_cop,
      package_version = p_package_version,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE b.package_id = p_package_id
    AND (
      p_package_version > b.package_version
      OR (p_package_version = b.package_version AND p_total_cop <> b.total_cop)
    );

  IF FOUND THEN
    v_corrected := true;
  ELSIF NOT EXISTS (SELECT 1 FROM public.budgets AS b WHERE b.package_id = p_package_id) THEN
    INSERT INTO public.budgets (package_id, total_cop, package_version)
    VALUES (p_package_id, p_total_cop, p_package_version);
    v_corrected := true;
  END IF;

  RETURN QUERY
    SELECT v_corrected, b.package_id, b.total_cop, b.package_version, b.updated_at
    FROM public.budgets AS b
    WHERE b.package_id = p_package_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_package_change(jsonb, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_retry_domain_event(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_retryable_domain_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_domain_event_failed(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_unresolved_domain_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_budget(uuid, integer, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.commit_package_change(jsonb, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_retry_domain_event(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_retryable_domain_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_domain_event_failed(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_unresolved_domain_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_budget(uuid, integer, bigint) TO service_role;
