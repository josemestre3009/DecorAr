-- Migration: revocable public share links for quotes
-- Requirement DECOR-53: enlace público seguro y revocable
--
-- Additive to 20261018000000_create_quotes.sql.
--
--   1. private.quote_share_links: at most one active link per quote. The
--      token itself is never stored, only a SHA-256 hash computed by the
--      application (the token is an HMAC over the link id, so the server can
--      recompute it to show it again without keeping a plaintext copy).
--   2. Trigger on public.quotes: creating a new version revokes the active
--      link of any earlier version of the same (owner_id, quote_number).
--   3. RPC (service_role only, SECURITY INVOKER):
--      - create_quote_share_link: idempotent; only for 'sent'/'accepted'
--        quotes; reuses a still-valid active link, replaces an expired one.
--      - get_quote_share_link / revoke_quote_share_link: owner-only.
--      - get_shared_quote: the only path anon-less code uses to read a
--        shared quote; returns NULL for anything revoked, expired or whose
--        quote is not 'sent'/'accepted' (never raises, so a missing or
--        malformed token is indistinguishable from an expired one).
--
-- anon and authenticated keep no privileges on this table, same rule as
-- public.quotes (DECOR-30): the public page reads through get_shared_quote
-- with the service_role client on the server, never a direct `.from()`.

-- ---------------------------------------------------------------------------
-- 1. Share links
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.quote_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes (id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,

  CONSTRAINT chk_quote_share_links_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT chk_quote_share_links_revoked_consistency CHECK (
    (revoked_at IS NULL) = (revoked_by IS NULL)
  )
);

-- One active (non-revoked) link per quote; the application upserts against
-- this to stay idempotent on retries instead of racing on a unique violation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_share_links_active_quote
  ON private.quote_share_links (quote_id)
  WHERE revoked_at IS NULL;

-- Looked up by the public route on every request; must stay unique so a hash
-- collision between two active links can never resolve to the wrong quote.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_share_links_active_token_hash
  ON private.quote_share_links (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quote_share_links_quote_id ON private.quote_share_links (quote_id);

ALTER TABLE private.quote_share_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.quote_share_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE private.quote_share_links TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Revoke the previous version's link when a new version is created
-- ---------------------------------------------------------------------------

-- Fires after INSERT on quotes (every version insert, including the first):
-- revokes any other active link under the same owner/number. Kept as a
-- trigger, not inside create_quote_version, so quote_share_links never has
-- to be imported by the quotes write path.
CREATE OR REPLACE FUNCTION private.revoke_previous_quote_share_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE private.quote_share_links AS l
  SET revoked_at = timezone('utc'::text, pg_catalog.now()), revoked_by = NEW.owner_id
  WHERE l.revoked_at IS NULL
    AND l.owner_id = NEW.owner_id
    AND l.quote_id IN (
      SELECT q.id
      FROM public.quotes AS q
      WHERE q.owner_id = NEW.owner_id
        AND q.quote_number = NEW.quote_number
        AND q.id <> NEW.id
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotes_revoke_previous_share_links ON public.quotes;
CREATE TRIGGER trg_quotes_revoke_previous_share_links
  AFTER INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION private.revoke_previous_quote_share_links();

REVOKE ALL ON FUNCTION private.revoke_previous_quote_share_links() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.revoke_previous_quote_share_links() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- Same wire shape the application reads from create/get: id, quoteId,
-- expiresAt, createdAt, revokedAt. The token itself never appears here.
CREATE OR REPLACE FUNCTION private.quote_share_link_json(p_link private.quote_share_links)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'id', p_link.id,
    'quoteId', p_link.quote_id,
    'expiresAt', p_link.expires_at,
    'createdAt', p_link.created_at,
    'revokedAt', p_link.revoked_at
  );
$$;

-- Idempotent create: reuses the active link while it has not expired,
-- replaces it (revoke + insert) once it has. Only quotes 'sent' or
-- 'accepted' may be shared; the quote row is locked so two concurrent
-- requests for the same quote serialize instead of racing on the partial
-- unique index.
CREATE OR REPLACE FUNCTION public.create_quote_share_link(
  p_owner_id uuid,
  p_quote_id uuid,
  p_link_id uuid,
  p_token_hash bytea,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_valid_until date;
  v_existing private.quote_share_links;
  v_link private.quote_share_links;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'quote.invalid_body';
  END IF;

  IF p_expires_at IS NULL THEN
    RAISE EXCEPTION 'quote.invalid_body';
  END IF;

  SELECT q.status, q.valid_until INTO v_status, v_valid_until
  FROM public.quotes AS q
  WHERE q.id = p_quote_id AND q.owner_id = p_owner_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote.not_found';
  END IF;

  IF v_status NOT IN ('sent', 'accepted') THEN
    RAISE EXCEPTION 'quote.share_not_allowed';
  END IF;

  -- End of day (America/Bogota) of valid_until, as a UTC instant: midnight of
  -- the next calendar day in that zone, converted to timestamptz.
  IF p_expires_at > ((v_valid_until + 1)::timestamp AT TIME ZONE 'America/Bogota') THEN
    RAISE EXCEPTION 'quote.share_expiry_too_far';
  END IF;

  SELECT * INTO v_existing
  FROM private.quote_share_links AS l
  WHERE l.quote_id = p_quote_id AND l.revoked_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.expires_at > timezone('utc'::text, pg_catalog.now()) THEN
      RETURN private.quote_share_link_json(v_existing);
    END IF;

    UPDATE private.quote_share_links AS l
    SET revoked_at = timezone('utc'::text, pg_catalog.now()), revoked_by = p_owner_id
    WHERE l.id = v_existing.id;
  END IF;

  INSERT INTO private.quote_share_links AS l (id, quote_id, owner_id, token_hash, expires_at)
  VALUES (p_link_id, p_quote_id, p_owner_id, p_token_hash, p_expires_at)
  RETURNING l.* INTO v_link;

  RETURN private.quote_share_link_json(v_link);
END;
$$;

-- Active link of a quote, or NULL if there is none. Owner-only.
CREATE OR REPLACE FUNCTION public.get_quote_share_link(
  p_owner_id uuid,
  p_quote_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_link private.quote_share_links;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  PERFORM 1 FROM public.quotes AS q WHERE q.id = p_quote_id AND q.owner_id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote.not_found';
  END IF;

  SELECT * INTO v_link
  FROM private.quote_share_links AS l
  WHERE l.quote_id = p_quote_id AND l.revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN private.quote_share_link_json(v_link);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_quote_share_link(
  p_owner_id uuid,
  p_quote_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_link private.quote_share_links;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  PERFORM 1 FROM public.quotes AS q WHERE q.id = p_quote_id AND q.owner_id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote.not_found';
  END IF;

  UPDATE private.quote_share_links AS l
  SET revoked_at = timezone('utc'::text, pg_catalog.now()), revoked_by = p_owner_id
  WHERE l.quote_id = p_quote_id AND l.revoked_at IS NULL
  RETURNING l.* INTO v_link;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote.share_link_not_found';
  END IF;

  RETURN private.quote_share_link_json(v_link);
END;
$$;

-- The only public read path. Never raises on a bad token: a malformed,
-- unknown, expired or revoked token, or a quote that is no longer
-- 'sent'/'accepted', all resolve to NULL so the caller cannot tell them apart.
CREATE OR REPLACE FUNCTION public.get_shared_quote(p_token_hash bytea)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_quote_id uuid;
  v_status text;
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN NULL;
  END IF;

  SELECT l.quote_id INTO v_quote_id
  FROM private.quote_share_links AS l
  WHERE l.token_hash = p_token_hash
    AND l.revoked_at IS NULL
    AND l.expires_at > timezone('utc'::text, pg_catalog.now());

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT q.status INTO v_status FROM public.quotes AS q WHERE q.id = v_quote_id;

  IF v_status IS NULL OR v_status NOT IN ('sent', 'accepted') THEN
    RETURN NULL;
  END IF;

  RETURN private.quote_json(v_quote_id);
END;
$$;

REVOKE ALL ON FUNCTION private.quote_share_link_json(private.quote_share_links)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_quote_share_link(uuid, uuid, uuid, bytea, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_quote_share_link(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_quote_share_link(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_shared_quote(bytea) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.quote_share_link_json(private.quote_share_links) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_quote_share_link(uuid, uuid, uuid, bytea, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_quote_share_link(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_quote_share_link(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_quote(bytea) TO service_role;
