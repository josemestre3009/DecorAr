-- Migration: idempotent budget persistence
-- Requirement DECOR-33: consumidor idempotente de presupuesto
--
-- `public.budgets` holds the confirmed total so the owner can read it for
-- resync (GET /api/packages/{id}/budget). `private.processed_events` is the
-- idempotency ledger for this consumer, following the same convention as
-- `private.domain_events` from DECOR-32: PostgREST does not expose `private`,
-- so only `service_role` can touch it. Every function is SECURITY INVOKER
-- with an empty search_path and fully qualified names.

CREATE TABLE IF NOT EXISTS public.budgets (
  package_id UUID PRIMARY KEY REFERENCES public.packages (id) ON DELETE CASCADE,
  total_cop BIGINT NOT NULL,
  package_version INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chk_budgets_total_non_negative CHECK (total_cop >= 0),
  CONSTRAINT chk_budgets_package_version_positive CHECK (package_version > 0)
);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

-- Deny-all until the owner read policy below; every write goes through
-- process_budget_event, executed by service_role only.
REVOKE ALL ON TABLE public.budgets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.budgets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.budgets TO service_role;

DROP POLICY IF EXISTS "Owners can view their budget" ON public.budgets;
CREATE POLICY "Owners can view their budget"
  ON public.budgets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.packages AS p
      WHERE p.id = budgets.package_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

CREATE TABLE IF NOT EXISTS private.processed_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consumer TEXT NOT NULL,
  event_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT uq_processed_events_consumer_event_id UNIQUE (consumer, event_id),
  CONSTRAINT chk_processed_events_consumer_non_empty CHECK (length(trim(consumer)) > 0),
  CONSTRAINT chk_processed_events_event_id_non_empty CHECK (length(trim(event_id)) > 0)
);

ALTER TABLE private.processed_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.processed_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.processed_events TO service_role;

-- Records the processed eventId and, only if it is new and its
-- packageVersion is newer than what is stored, upserts the budget total, in
-- one transaction. A repeated eventId short-circuits before touching
-- `budgets`: this is what makes a replayed event a no-op instead of a
-- duplicate recalculation. An eventId that is new but carries an
-- out-of-order (not strictly greater) packageVersion is still recorded as
-- processed, so it is never retried, but it MUST NOT move the stored total.
-- Returns the current budget row and whether this call applied a change, so
-- the caller only publishes budget.recalculated when applied is true.
CREATE OR REPLACE FUNCTION public.process_budget_event(
  p_consumer text,
  p_event_id text,
  p_package_id uuid,
  p_package_version integer,
  p_total_cop bigint
)
RETURNS TABLE (
  applied boolean,
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
  v_applied boolean := false;
BEGIN
  IF p_consumer IS NULL OR pg_catalog.length(pg_catalog.btrim(p_consumer)) = 0 THEN
    RAISE EXCEPTION 'budget.invalid_consumer';
  END IF;

  IF p_event_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_event_id)) = 0 THEN
    RAISE EXCEPTION 'event.invalid';
  END IF;

  IF p_package_version IS NULL OR p_package_version <= 0 THEN
    RAISE EXCEPTION 'package.invalid_version';
  END IF;

  IF p_total_cop IS NULL OR p_total_cop < 0 THEN
    RAISE EXCEPTION 'budget.invalid_total';
  END IF;

  BEGIN
    INSERT INTO private.processed_events (consumer, event_id)
    VALUES (p_consumer, p_event_id);
  EXCEPTION
    WHEN unique_violation THEN
      -- Exact replay: report the current state without recalculating.
      RETURN QUERY
        SELECT false, b.package_id, b.total_cop, b.package_version, b.updated_at
        FROM public.budgets AS b
        WHERE b.package_id = p_package_id;
      RETURN;
  END;

  UPDATE public.budgets AS b
  SET total_cop = p_total_cop,
      package_version = p_package_version,
      updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now())
  WHERE b.package_id = p_package_id
    AND p_package_version > b.package_version;

  IF FOUND THEN
    v_applied := true;
  ELSIF NOT EXISTS (SELECT 1 FROM public.budgets AS b WHERE b.package_id = p_package_id) THEN
    INSERT INTO public.budgets (package_id, total_cop, package_version)
    VALUES (p_package_id, p_total_cop, p_package_version);
    v_applied := true;
  END IF;

  RETURN QUERY
    SELECT v_applied, b.package_id, b.total_cop, b.package_version, b.updated_at
    FROM public.budgets AS b
    WHERE b.package_id = p_package_id;
END;
$$;

REVOKE ALL ON FUNCTION public.process_budget_event(text, text, uuid, integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_budget_event(text, text, uuid, integer, bigint) TO service_role;
