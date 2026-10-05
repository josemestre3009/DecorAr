import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("catalog_modules SQL migration contract", () => {
  it("declares all required check constraints, unique index, and RLS policy", async () => {
    const migrationPath = resolve("supabase/migrations/20261003000000_create_catalog_modules.sql");
    const sql = await readFile(migrationPath, "utf-8");

    // Table definition
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.catalog_modules");

    // Unique constraint
    expect(sql).toContain("CONSTRAINT uq_catalog_modules_asset_version UNIQUE (asset_id, version)");

    // Positive and non-empty checks
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_version_positive CHECK (version > 0)");
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_asset_id_non_empty CHECK (length(trim(asset_id)) > 0)");
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_name_non_empty CHECK (length(trim(name)) > 0)");
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_price_positive CHECK (price_cop > 0)");
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_area_positive CHECK (area_m2 > 0)");
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_width_positive CHECK (width_m IS NULL OR width_m > 0)");
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_height_positive CHECK (height_m IS NULL OR height_m > 0)");
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_depth_positive CHECK (depth_m IS NULL OR depth_m > 0)");

    // Active completeness check
    expect(sql).toContain("CONSTRAINT chk_catalog_modules_active_completeness CHECK");
    expect(sql).toContain("status = 'draft' OR (");
    expect(sql).toContain("status = 'active' AND");
    expect(sql).toContain("glb_url IS NOT NULL AND length(trim(glb_url)) > 0");
    expect(sql).toContain("usdz_url IS NOT NULL AND length(trim(usdz_url)) > 0");
    expect(sql).toContain("width_m IS NOT NULL");
    expect(sql).toContain("height_m IS NOT NULL");
    expect(sql).toContain("depth_m IS NOT NULL");

    // RLS policy
    expect(sql).toContain("ALTER TABLE public.catalog_modules ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("CREATE POLICY \"Public can view active catalog modules\"");
    expect(sql).toContain("USING (status = 'active');");
  });
});
