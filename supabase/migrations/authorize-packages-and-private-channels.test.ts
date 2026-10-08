// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PACKAGE_A = "11111111-1111-4111-8111-111111111111";
const PACKAGE_B = "22222222-2222-4222-8222-222222222222";
const ITEM_A = "33333333-3333-4333-8333-333333333333";

const supabaseShim = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;

  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  CREATE SCHEMA realtime;
  CREATE TABLE realtime.messages (topic text NOT NULL, extension text NOT NULL);
  ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('realtime.topic', true), '')
  $$;

  GRANT USAGE ON SCHEMA public, auth, realtime TO anon, authenticated, service_role;
  GRANT SELECT ON realtime.messages TO authenticated;
`;

describe("DECOR-30 executable authorization policies", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);

    const directory = resolve("supabase/migrations");
    const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const migration of migrations) await db.exec(await readFile(resolve(directory, migration), "utf8"));

    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
      INSERT INTO public.catalog_modules (
        id, asset_id, version, name, price_cop, area_m2, width_m, height_m, depth_m,
        glb_url, usdz_url, poster_url, status
      ) VALUES (
        '44444444-4444-4444-8444-444444444444', 'fixture', 1, 'Fixture', 1, 1, 1, 1, 1,
        'https://example.com/a.glb', 'https://example.com/a.usdz', 'https://example.com/a.webp', 'active'
      );
      INSERT INTO public.packages (id, user_id) VALUES
        ('${PACKAGE_A}', '${USER_A}'), ('${PACKAGE_B}', '${USER_B}');
      INSERT INTO public.package_items (id, package_id, module_id) VALUES
        ('${ITEM_A}', '${PACKAGE_A}', '44444444-4444-4444-8444-444444444444');
      INSERT INTO realtime.messages (topic, extension) VALUES
        ('package:${PACKAGE_A}', 'broadcast'), ('package:${PACKAGE_A}', 'presence');
    `);
  }, 30_000);

  afterAll(async () => db?.close());

  async function asRole<T extends Record<string, unknown>>(
    role: "anon" | "authenticated",
    userId: string | null,
    topic: string | null,
    sql: string,
  ) {
    await db.exec(`
      SET ROLE ${role};
      SELECT set_config('request.jwt.claim.sub', '${userId ?? ""}', false);
      SELECT set_config('realtime.topic', '${topic ?? ""}', false);
    `);
    try {
      return await db.query<T>(sql);
    } finally {
      await db.exec("RESET ROLE");
    }
  }

  it("lets A read only A's package and items, while B sees no rows", async () => {
    const own = await asRole<{ id: string }>("authenticated", USER_A, null, "SELECT id FROM public.packages ORDER BY id");
    const foreign = await asRole<{ id: string }>("authenticated", USER_B, null, `SELECT id FROM public.packages WHERE id = '${PACKAGE_A}'`);
    const items = await asRole<{ id: string }>("authenticated", USER_A, null, "SELECT id FROM public.package_items");

    expect(own.rows).toEqual([{ id: PACKAGE_A }]);
    expect(foreign.rows).toEqual([]);
    expect(items.rows).toEqual([{ id: ITEM_A }]);
  });

  it("denies anonymous reads and direct client writes", async () => {
    await expect(asRole("anon", null, null, "SELECT id FROM public.packages")).rejects.toMatchObject({ code: "42501" });
    await expect(
      asRole("authenticated", USER_A, null, `UPDATE public.packages SET version = 2 WHERE id = '${PACKAGE_A}'`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps internal tables and privileged RPCs unavailable to clients", async () => {
    const privileges = await db.query<{
      private_usage: boolean;
      rpc_execute: boolean;
      catalog_read: boolean;
      catalog_write: boolean;
      catalog_activate: boolean;
    }>(`
      SELECT
        has_schema_privilege('authenticated', 'private', 'USAGE') AS private_usage,
        has_function_privilege('authenticated', 'public.commit_package_change(jsonb,integer)', 'EXECUTE') AS rpc_execute,
        has_table_privilege('authenticated', 'public.catalog_modules', 'SELECT') AS catalog_read,
        has_table_privilege('authenticated', 'public.catalog_modules', 'INSERT') AS catalog_write,
        has_function_privilege(
          'authenticated',
          'public.activate_catalog_module(text,integer,text,text,text,numeric,numeric,numeric)',
          'EXECUTE'
        ) AS catalog_activate
    `);

    expect(privileges.rows).toEqual([{
      private_usage: false,
      rpc_execute: false,
      catalog_read: true,
      catalog_write: false,
      catalog_activate: false,
    }]);
    await expect(asRole("authenticated", USER_A, null, "SELECT event_id FROM private.domain_events")).rejects.toMatchObject({ code: "42501" });
  });

  it("allows only the owner to receive package broadcasts", async () => {
    const own = await asRole<{ extension: string }>(
      "authenticated",
      USER_A,
      `package:${PACKAGE_A}`,
      "SELECT extension FROM realtime.messages ORDER BY extension",
    );
    const foreign = await asRole<{ extension: string }>(
      "authenticated",
      USER_B,
      `package:${PACKAGE_A}`,
      "SELECT extension FROM realtime.messages",
    );

    expect(own.rows).toEqual([{ extension: "broadcast" }]);
    expect(foreign.rows).toEqual([]);
  });

  it("does not let authenticated clients publish broadcasts", async () => {
    await expect(
      asRole(
        "authenticated",
        USER_A,
        `package:${PACKAGE_A}`,
        `INSERT INTO realtime.messages (topic, extension) VALUES ('package:${PACKAGE_A}', 'broadcast')`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
