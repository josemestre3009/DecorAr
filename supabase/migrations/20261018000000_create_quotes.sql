-- Migration: versioned quotes with frozen prices
-- Requirement DECOR-50: base de cotizaciones versionadas
--
-- Additive to 20261017000000_validate_package_outbox_identity.sql.
--
--   1. private.quote_counters: per-owner quote number allocation.
--   2. public.quotes / public.quote_lines: one immutable row per quote version
--      with the client/event data, commercial terms, totals and lines copied
--      at creation time. Changing the package or the catalog afterwards never
--      alters a stored version; a new version is a new row with the same
--      number and version + 1.
--   3. Immutability triggers: only `status` changes (through the allowed
--      transitions) and `package_id` may become NULL when the source package
--      is deleted. Lines never change.
--   4. Owner SELECT only through RLS; no anon/authenticated writes;
--      service_role performs every mutation through the atomic RPCs below.
--
-- Totals are computed in the application domain (src/modules/quotes/domain);
-- the RPCs re-verify the snapshot against the locked package and the CHECK
-- constraints keep the stored arithmetic consistent.
--
-- Every function is SECURITY INVOKER with an empty search_path and fully
-- qualified names, executable only by service_role, following the convention
-- of the earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. Per-owner quote numbers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.quote_counters (
  owner_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  last_number INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT chk_quote_counters_last_number CHECK (last_number >= 0)
);

ALTER TABLE private.quote_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.quote_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE private.quote_counters TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Quotes and frozen lines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Kept as a reference only: deleting the package must not erase history.
  package_id UUID REFERENCES public.packages (id) ON DELETE SET NULL,
  source_package_version INTEGER NOT NULL,
  quote_number INTEGER NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',

  -- Client and event data frozen from the package.
  client_name TEXT,
  event_name TEXT NOT NULL,
  event_date DATE,
  venue TEXT,
  event_type TEXT,

  -- Commercial terms. Rates are basis points (1 % = 100).
  valid_until DATE NOT NULL,
  conditions TEXT,
  currency TEXT NOT NULL DEFAULT 'COP',
  discount_rate_bp INTEGER NOT NULL,
  tax_rate_bp INTEGER NOT NULL,
  deposit_rate_bp INTEGER NOT NULL,

  -- Server-computed totals, whole COP.
  subtotal_cop BIGINT NOT NULL,
  discount_cop BIGINT NOT NULL,
  tax_cop BIGINT NOT NULL,
  total_cop BIGINT NOT NULL,
  deposit_cop BIGINT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT uq_quotes_owner_number_version UNIQUE (owner_id, quote_number, version),
  CONSTRAINT chk_quotes_number_positive CHECK (quote_number > 0),
  CONSTRAINT chk_quotes_version_positive CHECK (version > 0),
  CONSTRAINT chk_quotes_source_version_positive CHECK (source_package_version > 0),
  CONSTRAINT chk_quotes_status CHECK (status IN ('draft', 'sent', 'accepted', 'expired')),
  CONSTRAINT chk_quotes_currency CHECK (currency = 'COP'),
  CONSTRAINT chk_quotes_event_name CHECK (length(btrim(event_name)) BETWEEN 1 AND 120),
  CONSTRAINT chk_quotes_client_name_length
    CHECK (client_name IS NULL OR length(btrim(client_name)) BETWEEN 1 AND 120),
  CONSTRAINT chk_quotes_venue_length CHECK (venue IS NULL OR length(btrim(venue)) <= 200),
  CONSTRAINT chk_quotes_event_type_length
    CHECK (event_type IS NULL OR length(btrim(event_type)) <= 80),
  CONSTRAINT chk_quotes_conditions_length
    CHECK (conditions IS NULL OR length(conditions) <= 2000),
  CONSTRAINT chk_quotes_rates CHECK (
    discount_rate_bp BETWEEN 0 AND 10000 AND
    tax_rate_bp BETWEEN 0 AND 10000 AND
    deposit_rate_bp BETWEEN 0 AND 10000
  ),
  CONSTRAINT chk_quotes_amounts_non_negative CHECK (
    subtotal_cop >= 0 AND discount_cop >= 0 AND tax_cop >= 0 AND
    total_cop >= 0 AND deposit_cop >= 0
  ),
  CONSTRAINT chk_quotes_discount_within_subtotal CHECK (discount_cop <= subtotal_cop),
  CONSTRAINT chk_quotes_total_arithmetic CHECK (total_cop = subtotal_cop - discount_cop + tax_cop),
  CONSTRAINT chk_quotes_deposit_within_total CHECK (deposit_cop <= total_cop)
);

CREATE INDEX IF NOT EXISTS idx_quotes_owner_id ON public.quotes (owner_id);
CREATE INDEX IF NOT EXISTS idx_quotes_package_id ON public.quotes (package_id);

CREATE TABLE IF NOT EXISTS public.quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  -- Reference only (no FK): the line keeps its frozen name and price even if
  -- the catalog row is later replaced.
  module_id UUID NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cop BIGINT NOT NULL,
  line_total_cop BIGINT NOT NULL,

  CONSTRAINT uq_quote_lines_quote_position UNIQUE (quote_id, position),
  CONSTRAINT chk_quote_lines_position_positive CHECK (position > 0),
  CONSTRAINT chk_quote_lines_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT chk_quote_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT chk_quote_lines_unit_price_non_negative CHECK (unit_price_cop >= 0),
  CONSTRAINT chk_quote_lines_total_arithmetic CHECK (line_total_cop = quantity * unit_price_cop)
);

CREATE INDEX IF NOT EXISTS idx_quote_lines_quote_id ON public.quote_lines (quote_id);

-- ---------------------------------------------------------------------------
-- 3. Immutability
-- ---------------------------------------------------------------------------

-- Only `status` may change, and only through the allowed transitions (same
-- table as src/modules/quotes/domain/quote-status.ts). `package_id` may only
-- become NULL, which is what ON DELETE SET NULL does when the package goes.
CREATE OR REPLACE FUNCTION public.guard_quote_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR (NEW.package_id IS DISTINCT FROM OLD.package_id AND NEW.package_id IS NOT NULL)
    OR NEW.source_package_version IS DISTINCT FROM OLD.source_package_version
    OR NEW.quote_number IS DISTINCT FROM OLD.quote_number
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.client_name IS DISTINCT FROM OLD.client_name
    OR NEW.event_name IS DISTINCT FROM OLD.event_name
    OR NEW.event_date IS DISTINCT FROM OLD.event_date
    OR NEW.venue IS DISTINCT FROM OLD.venue
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.conditions IS DISTINCT FROM OLD.conditions
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.discount_rate_bp IS DISTINCT FROM OLD.discount_rate_bp
    OR NEW.tax_rate_bp IS DISTINCT FROM OLD.tax_rate_bp
    OR NEW.deposit_rate_bp IS DISTINCT FROM OLD.deposit_rate_bp
    OR NEW.subtotal_cop IS DISTINCT FROM OLD.subtotal_cop
    OR NEW.discount_cop IS DISTINCT FROM OLD.discount_cop
    OR NEW.tax_cop IS DISTINCT FROM OLD.tax_cop
    OR NEW.total_cop IS DISTINCT FROM OLD.total_cop
    OR NEW.deposit_cop IS DISTINCT FROM OLD.deposit_cop
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'quote.immutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('sent', 'expired')) OR
      (OLD.status = 'sent' AND NEW.status IN ('accepted', 'expired'))
    ) THEN
      RAISE EXCEPTION 'quote.invalid_status_transition';
    END IF;

    NEW.status_changed_at := timezone('utc'::text, pg_catalog.now());
  ELSE
    NEW.status_changed_at := OLD.status_changed_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotes_immutable ON public.quotes;
CREATE TRIGGER trg_quotes_immutable
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.guard_quote_immutability();

CREATE OR REPLACE FUNCTION public.reject_quote_line_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'quote.immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_lines_immutable ON public.quote_lines;
CREATE TRIGGER trg_quote_lines_immutable
  BEFORE UPDATE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.reject_quote_line_update();

-- ---------------------------------------------------------------------------
-- 4. Privileges and RLS
-- ---------------------------------------------------------------------------

-- Owner reads through RLS; nobody writes directly. service_role is the only
-- role that mutates, always through the RPCs below. It cannot UPDATE or
-- DELETE lines at all (they disappear only with their quote, by cascade).
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.quotes, public.quote_lines FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quotes TO service_role;
GRANT SELECT, INSERT ON TABLE public.quote_lines TO service_role;
GRANT SELECT ON TABLE public.quotes, public.quote_lines TO authenticated;

DROP POLICY IF EXISTS "Owners can view their quotes" ON public.quotes;
CREATE POLICY "Owners can view their quotes"
  ON public.quotes
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Owners can view lines of their quotes" ON public.quote_lines;
CREATE POLICY "Owners can view lines of their quotes"
  ON public.quote_lines
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.quotes AS q
      WHERE q.id = quote_lines.quote_id
        AND q.owner_id = (SELECT auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------

-- Same wire shape as `select('*, quote_lines(*)')` on the tables, so a single
-- TypeScript mapper reads both the RPC result and the RLS reads.
CREATE OR REPLACE FUNCTION private.quote_json(p_quote_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.to_jsonb(q) || pg_catalog.jsonb_build_object(
    'quote_lines',
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) ORDER BY l.position)
        FROM public.quote_lines AS l
        WHERE l.quote_id = q.id
      ),
      '[]'::jsonb
    )
  )
  FROM public.quotes AS q
  WHERE q.id = p_quote_id;
$$;

-- Inserts one version after re-verifying the snapshot against the locked
-- package: same version the application read, same modules, quantities,
-- names and catalog prices, and a subtotal equal to the sum of the lines.
CREATE OR REPLACE FUNCTION private.insert_quote_version(
  p_owner_id uuid,
  p_package_id uuid,
  p_expected_package_version integer,
  p_quote_number integer,
  p_version integer,
  p_quote jsonb,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_package public.packages%ROWTYPE;
  v_quote_id uuid;
  v_actual_count integer;
  v_provided_count integer;
  v_mismatch boolean;
  v_lines_total bigint;
  v_discount_cop bigint;
  v_taxable_base_cop bigint;
  v_tax_cop bigint;
  v_total_cop bigint;
  v_deposit_cop bigint;
BEGIN
  IF p_quote IS NULL OR pg_catalog.jsonb_typeof(p_quote) <> 'object' THEN
    RAISE EXCEPTION 'quote.invalid_body';
  END IF;

  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'quote.invalid_line';
  END IF;

  SELECT * INTO v_package
  FROM public.packages AS p
  WHERE p.id = p_package_id AND p.user_id = p_owner_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  IF p_expected_package_version IS NULL OR v_package.version <> p_expected_package_version THEN
    RAISE EXCEPTION 'quote.package_version_conflict';
  END IF;

  SELECT pg_catalog.count(DISTINCT pi.module_id) INTO v_actual_count
  FROM public.package_items AS pi
  WHERE pi.package_id = p_package_id;

  IF v_actual_count = 0 THEN
    RAISE EXCEPTION 'quote.empty_package';
  END IF;

  v_provided_count := pg_catalog.jsonb_array_length(p_lines);

  WITH provided AS (
    SELECT
      (l ->> 'moduleId')::uuid AS module_id,
      l ->> 'name' AS name,
      (l ->> 'quantity')::bigint AS quantity,
      (l ->> 'unitPriceCop')::bigint AS unit_price_cop
    FROM pg_catalog.jsonb_array_elements(p_lines) AS l
  ),
  actual AS (
    SELECT
      pi.module_id,
      cm.name,
      pg_catalog.count(*)::bigint AS quantity,
      cm.price_cop::bigint AS unit_price_cop
    FROM public.package_items AS pi
    JOIN public.catalog_modules AS cm ON cm.id = pi.module_id
    WHERE pi.package_id = p_package_id
    GROUP BY pi.module_id, cm.name, cm.price_cop
  )
  SELECT EXISTS (
    (SELECT module_id, name, quantity, unit_price_cop FROM provided
     EXCEPT
     SELECT module_id, name, quantity, unit_price_cop FROM actual)
    UNION ALL
    (SELECT module_id, name, quantity, unit_price_cop FROM actual
     EXCEPT
     SELECT module_id, name, quantity, unit_price_cop FROM provided)
  ) INTO v_mismatch;

  IF v_mismatch OR v_provided_count <> v_actual_count THEN
    RAISE EXCEPTION 'quote.snapshot_mismatch';
  END IF;

  SELECT COALESCE(pg_catalog.sum((l ->> 'lineTotalCop')::bigint), 0) INTO v_lines_total
  FROM pg_catalog.jsonb_array_elements(p_lines) AS l;

  IF v_lines_total <> (p_quote ->> 'subtotalCop')::bigint THEN
    RAISE EXCEPTION 'quote.invalid_totals';
  END IF;

  IF (p_quote ->> 'discountRateBp')::integer NOT BETWEEN 0 AND 10000
    OR (p_quote ->> 'taxRateBp')::integer NOT BETWEEN 0 AND 10000
    OR (p_quote ->> 'depositRateBp')::integer NOT BETWEEN 0 AND 10000
  THEN
    RAISE EXCEPTION 'chk_quotes_rates';
  END IF;

  v_discount_cop := pg_catalog.trunc(
    (v_lines_total::numeric * (p_quote ->> 'discountRateBp')::integer + 5000) / 10000
  )::bigint;
  v_taxable_base_cop := v_lines_total - v_discount_cop;
  v_tax_cop := pg_catalog.trunc(
    (v_taxable_base_cop::numeric * (p_quote ->> 'taxRateBp')::integer + 5000) / 10000
  )::bigint;
  v_total_cop := v_taxable_base_cop + v_tax_cop;
  v_deposit_cop := pg_catalog.trunc(
    (v_total_cop::numeric * (p_quote ->> 'depositRateBp')::integer + 5000) / 10000
  )::bigint;

  IF (p_quote ->> 'discountCop')::bigint <> v_discount_cop
    OR (p_quote ->> 'taxCop')::bigint <> v_tax_cop
    OR (p_quote ->> 'totalCop')::bigint <> v_total_cop
    OR (p_quote ->> 'depositCop')::bigint <> v_deposit_cop
  THEN
    RAISE EXCEPTION 'quote.invalid_totals';
  END IF;

  INSERT INTO public.quotes (
    owner_id, package_id, source_package_version, quote_number, version, status,
    client_name, event_name, event_date, venue, event_type,
    valid_until, conditions, discount_rate_bp, tax_rate_bp, deposit_rate_bp,
    subtotal_cop, discount_cop, tax_cop, total_cop, deposit_cop
  ) VALUES (
    p_owner_id, p_package_id, v_package.version, p_quote_number, p_version, 'draft',
    COALESCE(
      NULLIF(pg_catalog.btrim(p_quote ->> 'clientName'), ''),
      NULLIF(pg_catalog.btrim(v_package.client_name), '')
    ),
    v_package.name, v_package.event_date, v_package.venue, v_package.event_type,
    (p_quote ->> 'validUntil')::date,
    NULLIF(pg_catalog.btrim(p_quote ->> 'conditions'), ''),
    (p_quote ->> 'discountRateBp')::integer,
    (p_quote ->> 'taxRateBp')::integer,
    (p_quote ->> 'depositRateBp')::integer,
    (p_quote ->> 'subtotalCop')::bigint,
    v_discount_cop,
    v_tax_cop,
    v_total_cop,
    v_deposit_cop
  )
  RETURNING id INTO v_quote_id;

  INSERT INTO public.quote_lines (
    quote_id, position, module_id, name, quantity, unit_price_cop, line_total_cop
  )
  SELECT
    v_quote_id,
    (l ->> 'position')::integer,
    (l ->> 'moduleId')::uuid,
    l ->> 'name',
    (l ->> 'quantity')::integer,
    (l ->> 'unitPriceCop')::bigint,
    (l ->> 'lineTotalCop')::bigint
  FROM pg_catalog.jsonb_array_elements(p_lines) AS l;

  RETURN v_quote_id;
END;
$$;

-- Version 1 of a new quote: allocates the next per-owner number atomically
-- (the upsert row lock serializes concurrent creations of the same owner).
CREATE OR REPLACE FUNCTION public.create_quote(
  p_owner_id uuid,
  p_package_id uuid,
  p_expected_package_version integer,
  p_quote jsonb,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_number integer;
  v_quote_id uuid;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'package.not_found';
  END IF;

  INSERT INTO private.quote_counters AS c (owner_id, last_number)
  VALUES (p_owner_id, 1)
  ON CONFLICT (owner_id) DO UPDATE SET last_number = c.last_number + 1
  RETURNING c.last_number INTO v_number;

  v_quote_id := private.insert_quote_version(
    p_owner_id, p_package_id, p_expected_package_version, v_number, 1, p_quote, p_lines
  );

  RETURN private.quote_json(v_quote_id);
END;
$$;

-- New version of an existing quote number, taken again from the current
-- package. Previous versions are never touched.
CREATE OR REPLACE FUNCTION public.create_quote_version(
  p_owner_id uuid,
  p_quote_id uuid,
  p_expected_package_version integer,
  p_quote jsonb,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_number integer;
  v_package_id uuid;
  v_version integer;
  v_quote_id uuid;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  SELECT q.quote_number, q.package_id INTO v_number, v_package_id
  FROM public.quotes AS q
  WHERE q.id = p_quote_id AND q.owner_id = p_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote.not_found';
  END IF;

  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'quote.package_missing';
  END IF;

  -- Serializes version allocation per owner, like number allocation.
  PERFORM 1 FROM private.quote_counters AS c WHERE c.owner_id = p_owner_id FOR UPDATE;

  SELECT pg_catalog.max(q.version) + 1 INTO v_version
  FROM public.quotes AS q
  WHERE q.owner_id = p_owner_id AND q.quote_number = v_number;

  v_quote_id := private.insert_quote_version(
    p_owner_id, v_package_id, p_expected_package_version, v_number, v_version, p_quote, p_lines
  );

  RETURN private.quote_json(v_quote_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.change_quote_status(
  p_owner_id uuid,
  p_quote_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'auth.unauthenticated';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('draft', 'sent', 'accepted', 'expired') THEN
    RAISE EXCEPTION 'quote.invalid_status';
  END IF;

  PERFORM 1 FROM public.quotes AS q
  WHERE q.id = p_quote_id AND q.owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote.not_found';
  END IF;

  UPDATE public.quotes AS q
  SET status = p_status
  WHERE q.id = p_quote_id AND q.owner_id = p_owner_id;

  RETURN private.quote_json(p_quote_id);
END;
$$;

REVOKE ALL ON FUNCTION public.guard_quote_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_quote_line_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.quote_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.insert_quote_version(uuid, uuid, integer, integer, integer, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_quote(uuid, uuid, integer, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_quote_version(uuid, uuid, integer, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.change_quote_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.quote_json(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.insert_quote_version(uuid, uuid, integer, integer, integer, jsonb, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_quote(uuid, uuid, integer, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_quote_version(uuid, uuid, integer, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.change_quote_status(uuid, uuid, text) TO service_role;
