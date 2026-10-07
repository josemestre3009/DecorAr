import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("activate_catalog_module SQL migration contract", () => {
  it("declares SECURITY INVOKER, empty search_path, atomic update and validations", async () => {
    const migrationPath = resolve("supabase/migrations/20261007005000_replace_active_catalog_version.sql");
    const sql = await readFile(migrationPath, "utf-8");

    // Declares function with schema qualification
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.activate_catalog_module");

    // Enforces SECURITY INVOKER
    expect(sql).toContain("SECURITY INVOKER");

    // Enforces empty search_path
    expect(sql).toContain("SET search_path = ''");

    // Validations
    expect(sql).toContain("RAISE EXCEPTION 'asset_id cannot be empty'");
    expect(sql).toContain("RAISE EXCEPTION 'version must be an integer >= 1'");
    expect(sql).toContain("RAISE EXCEPTION 'glb_url must be a valid HTTPS URL'");
    expect(sql).toContain("RAISE EXCEPTION 'usdz_url must be a valid HTTPS URL'");
    expect(sql).toContain("RAISE EXCEPTION 'poster_url must be a valid HTTPS URL'");
    expect(sql).toContain("RAISE EXCEPTION 'width_m must be a number > 0'");
    expect(sql).toContain("RAISE EXCEPTION 'height_m must be a number > 0'");
    expect(sql).toContain("RAISE EXCEPTION 'depth_m must be a number > 0'");
    expect(sql).toContain("pg_catalog.btrim");

    // Atomic replacement and draft status enforcement
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("v_module.status <> 'draft'");
    expect(sql).toContain("is not in draft status");
    expect(sql).toContain("UPDATE public.catalog_modules");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("status = 'retired'");
    expect(sql).toContain("WHERE asset_id = p_asset_id AND version = p_version");
    expect(sql).toContain("RETURNING * INTO v_module");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_modules_one_active_asset");
    expect(sql).toContain("WHERE status = 'active'");
    expect(sql).toContain("('mesa'::text, 1, 13.714::numeric, 6.463::numeric, 8.139::numeric)");
  });
});
