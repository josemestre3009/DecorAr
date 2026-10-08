-- Migration: per-user RLS, minimal grants and private Realtime channels
-- Requirement DECOR-30: Auth, RLS y canales privados
--
-- RLS is a second barrier. Route Handlers validate session and ownership
-- before any use case (src/interfaces/packages/package-access.ts).
-- Internal tables stay in the `private` schema created by DECOR-32.

-- Catalog: everybody may read active modules; only service_role writes.
REVOKE ALL ON TABLE public.catalog_modules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.catalog_modules TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.catalog_modules TO service_role;

REVOKE ALL ON FUNCTION public.activate_catalog_module(text, integer, text, text, text, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_catalog_module(text, integer, text, text, text, numeric, numeric, numeric)
  TO service_role;

-- Packages: the owner may read; every write goes through
-- public.commit_package_change, executed by service_role only.
GRANT SELECT ON TABLE public.packages, public.package_items TO authenticated;

DROP POLICY IF EXISTS "Owners can view their packages" ON public.packages;
CREATE POLICY "Owners can view their packages"
  ON public.packages
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Owners can view items of their packages" ON public.package_items;
CREATE POLICY "Owners can view items of their packages"
  ON public.package_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.packages AS p
      WHERE p.id = package_items.package_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

-- Private Broadcast `package:{packageId}`: only the owner may join and
-- receive. There is no INSERT policy, so no client can publish on the
-- channel; the backend publishes with service_role, which bypasses RLS.
DROP POLICY IF EXISTS "Owners receive package broadcasts" ON realtime.messages;
CREATE POLICY "Owners receive package broadcasts"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND EXISTS (
      SELECT 1
      FROM public.packages AS p
      WHERE 'package:' || p.id::text = (SELECT realtime.topic())
        AND p.user_id = (SELECT auth.uid())
    )
  );
