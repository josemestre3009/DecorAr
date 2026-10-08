import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20261008000000_authorize_packages_and_private_channels.sql";

function policy(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE POLICY "${name}"`);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(";", start));
}

describe("DECOR-30 authorization SQL migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = (await readFile(resolve(MIGRATION), "utf-8")).replace(/\r\n/g, "\n");
  });

  it("lets owners read their packages and items, and nobody else", () => {
    const packages = policy(sql, "Owners can view their packages");
    expect(packages).toContain("ON public.packages");
    expect(packages).toContain("FOR SELECT");
    expect(packages).toContain("TO authenticated");
    expect(packages).toContain("USING ((SELECT auth.uid()) = user_id)");

    const items = policy(sql, "Owners can view items of their packages");
    expect(items).toContain("ON public.package_items");
    expect(items).toContain("TO authenticated");
    expect(items).toContain("p.user_id = (SELECT auth.uid())");
  });

  it("grants only SELECT to authenticated and nothing to anon on package tables", () => {
    expect(sql).toContain("GRANT SELECT ON TABLE public.packages, public.package_items TO authenticated;");
    expect(sql).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*TO[^;]*\b(anon|authenticated)\b/);
    expect(sql).not.toMatch(/GRANT[^;]*public\.package[^;]*\banon\b/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("limits the catalog to reads for clients and activation to service_role", () => {
    expect(sql).toContain("REVOKE ALL ON TABLE public.catalog_modules FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT SELECT ON TABLE public.catalog_modules TO anon, authenticated;");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.activate_catalog_module\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.activate_catalog_module\([^)]*\)\s+TO service_role;/);
  });

  it("authorizes the private channel package:{packageId} for its owner only", () => {
    const channel = policy(sql, "Owners receive package broadcasts");
    expect(channel).toContain("ON realtime.messages");
    expect(channel).toContain("FOR SELECT");
    expect(channel).toContain("TO authenticated");
    expect(channel).toContain("realtime.messages.extension = 'broadcast'");
    expect(channel).toContain("'package:' || p.id::text = (SELECT realtime.topic())");
    expect(channel).toContain("p.user_id = (SELECT auth.uid())");
  });

  it("never lets a client publish on a channel", () => {
    expect(sql).not.toMatch(/ON realtime\.messages\s+FOR (INSERT|UPDATE|ALL)/);
    expect(sql).not.toMatch(/GRANT[^;]*realtime\.messages/);
  });

  it("keeps internal tables private and avoids postgres_changes", () => {
    expect(sql).not.toMatch(/private\.domain_events/);
    expect(sql).not.toMatch(/GRANT[^;]*SCHEMA private/);
    expect(sql).not.toMatch(/supabase_realtime/i);
    expect(sql).not.toMatch(/postgres_changes/i);
    expect(sql).not.toContain("SECURITY DEFINER");
  });
});
