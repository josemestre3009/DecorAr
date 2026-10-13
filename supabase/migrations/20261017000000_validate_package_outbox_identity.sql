-- Defense in depth: structural RPC events must identify the package and owner
-- already locked by the caller, not an arbitrary Realtime channel.
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
    OR pg_catalog.lower(p_event ->> 'packageId') IS DISTINCT FROM pg_catalog.lower(p_package_id::text)
    OR pg_catalog.lower(p_event ->> 'userId') IS DISTINCT FROM pg_catalog.lower(p_user_id::text)
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
      v_event_id, p_expected_type, p_package_id, p_user_id,
      (p_event ->> 'occurredAt')::timestamptz, p_event, p_correlation_id
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'event.duplicate';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_package_outbox_event(jsonb, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_package_outbox_event(jsonb, text, uuid, uuid, text)
  TO service_role;
