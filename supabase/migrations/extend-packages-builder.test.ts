import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

describe("extend packages builder SQL migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(
      resolve("supabase/migrations/20261008000000_extend_packages_builder.sql"),
      "utf-8",
    );
  });

  it("adds space_type and capacity_m2 columns with positive capacity constraint", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS space_type TEXT");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS capacity_m2 NUMERIC(8, 2)");
    expect(sql).toContain("chk_packages_space_type");
    expect(sql).toContain("CHECK (space_type IN ('casa', 'aireLibre', 'salonSocial'))");
    expect(sql).toContain("chk_packages_capacity_positive");
    expect(sql).toContain("CHECK (capacity_m2 > 0)");
  });

  it("defines create_package function as SECURITY INVOKER with empty search_path", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.create_package");
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain("SET search_path = ''");
    expect(sql).not.toContain("SECURITY DEFINER");
  });

  it("restricts create_package function to service_role and revokes public/anon/authenticated", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.create_package(uuid, text, numeric) FROM PUBLIC, anon, authenticated;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.create_package(uuid, text, numeric) TO service_role;",
    );
  });

  it("validates space_type and capacity in the create_package RPC", () => {
    expect(sql).toContain("RAISE EXCEPTION 'package.invalid_space_type'");
    expect(sql).toContain("RAISE EXCEPTION 'package.invalid_capacity'");
  });
});
