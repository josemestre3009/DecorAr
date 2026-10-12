-- DECOR-42: commit several existing package.module.added events atomically.
CREATE FUNCTION public.commit_package_changes(
  p_events jsonb,
  p_expected_version integer,
  p_correlation_id text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event jsonb;
  v_package_id uuid;
  v_user_id uuid;
  v_version integer;
BEGIN
  IF p_events IS NULL
    OR pg_catalog.jsonb_typeof(p_events) <> 'array'
    OR pg_catalog.jsonb_array_length(p_events) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'event.invalid';
  END IF;

  IF p_events -> 0 ->> 'packageId' IS NULL
    OR p_events -> 0 ->> 'userId' IS NULL
    OR p_events -> 0 ->> 'packageId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_events -> 0 ->> 'userId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'event.invalid';
  END IF;

  v_package_id := (p_events -> 0 ->> 'packageId')::uuid;
  v_user_id := (p_events -> 0 ->> 'userId')::uuid;

  -- Replays the singular contract: any already-committed eventId in the
  -- batch short-circuits as `event.duplicate` before the expected-version
  -- comparison, so an exact replay never reports a misleading
  -- `package.version_conflict`. Whole-batch check, so a partially
  -- duplicated batch is rejected without mutating any unit.
  IF EXISTS (
    SELECT 1
    FROM private.domain_events AS d
    JOIN pg_catalog.jsonb_array_elements(p_events) AS e(value)
      ON d.event_id = e.value ->> 'eventId'
  ) THEN
    RAISE EXCEPTION 'event.duplicate';
  END IF;

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

  FOR v_event IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_events) AS e(value)
  LOOP
    IF v_event ->> 'type' IS DISTINCT FROM 'package.module.added'
      OR pg_catalog.lower(v_event ->> 'packageId') IS DISTINCT FROM v_package_id::text
      OR pg_catalog.lower(v_event ->> 'userId') IS DISTINCT FROM v_user_id::text THEN
      RAISE EXCEPTION 'event.invalid';
    END IF;

    v_version := public.commit_package_change(v_event, NULL, p_correlation_id);
  END LOOP;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_package_changes(jsonb, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_package_changes(jsonb, integer, text) TO service_role;
