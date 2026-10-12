// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODULE_ID = "11111111-1111-4111-8111-111111111111";

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

let db: PGlite;

function event(packageId: string, moduleId = MODULE_ID) {
  return {
    eventId: randomUUID(),
    occurredAt: "2026-10-12T12:00:00.000Z",
    packageId,
    payload: { itemId: randomUUID(), moduleId },
    schemaVersion: 1,
    type: "package.module.added",
    userId: USER_ID,
  };
}

describe("DECOR-42 migration: atomic package item batches", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);
    const directory = resolve("supabase/migrations");
    for (const migration of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
      await db.exec(await readFile(resolve(directory, migration), "utf8"));
    }
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_ID}');
      INSERT INTO public.catalog_modules (
        id, asset_id, version, name, price_cop, area_m2, width_m, height_m, depth_m,
        glb_url, usdz_url, poster_url, status
      ) VALUES ('${MODULE_ID}', 'mesa', 1, 'Mesa', 100, 2, 1, 1, 1,
        'https://example.com/a.glb', 'https://example.com/a.usdz', null, 'active');
    `);
  });

  afterAll(async () => db?.close());

  async function createPackage() {
    const packageId = randomUUID();
    await db.query(
      `INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version)
       VALUES ($1, $2, 'casa', 20, 1)`,
      [packageId, USER_ID],
    );
    return packageId;
  }

  it("confirma todas las unidades y eventos con una versión por unidad", async () => {
    const packageId = await createPackage();
    const events = [event(packageId), event(packageId), event(packageId)];
    const result = await db.query<{ version: number }>(
      `SELECT public.commit_package_changes($1::jsonb, 1, 'corr-batch') AS version`,
      [JSON.stringify(events)],
    );

    expect(result.rows[0].version).toBe(4);
    const counts = await db.query<{ items: number; events: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.package_items WHERE package_id = '${packageId}') AS items,
        (SELECT count(*)::int FROM private.domain_events WHERE package_id = '${packageId}') AS events
    `);
    expect(counts.rows[0]).toEqual({ events: 3, items: 3 });
  });

  it("replay exacto del lote devuelve event.duplicate antes de version_conflict", async () => {
    const packageId = await createPackage();
    const events = [event(packageId), event(packageId)];
    const first = await db.query<{ version: number }>(
      `SELECT public.commit_package_changes($1::jsonb, 1, 'corr-replay') AS version`,
      [JSON.stringify(events)],
    );
    expect(first.rows[0].version).toBe(3);

    await expect(
      db.query(`SELECT public.commit_package_changes($1::jsonb, 1, 'corr-replay')`, [
        JSON.stringify(events),
      ]),
    ).rejects.toThrow(/event.duplicate/);

    const snapshot = await db.query<{ items: number; events: number; version: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.package_items WHERE package_id = '${packageId}') AS items,
        (SELECT count(*)::int FROM private.domain_events WHERE package_id = '${packageId}') AS events,
        (SELECT version FROM public.packages WHERE id = '${packageId}') AS version
    `);
    expect(snapshot.rows[0]).toEqual({ events: 2, items: 2, version: 3 });
  });

  it("rechaza un lote parcialmente duplicado sin mutar datos", async () => {
    const packageId = await createPackage();
    const committed = event(packageId);
    await db.query(`SELECT public.commit_package_changes($1::jsonb, 1, null)`, [
      JSON.stringify([committed]),
    ]);

    await expect(
      db.query(`SELECT public.commit_package_changes($1::jsonb, 2, null)`, [
        JSON.stringify([committed, event(packageId)]),
      ]),
    ).rejects.toThrow(/event.duplicate/);

    const snapshot = await db.query<{ items: number; events: number; version: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.package_items WHERE package_id = '${packageId}') AS items,
        (SELECT count(*)::int FROM private.domain_events WHERE package_id = '${packageId}') AS events,
        (SELECT version FROM public.packages WHERE id = '${packageId}') AS version
    `);
    expect(snapshot.rows[0]).toEqual({ events: 1, items: 1, version: 2 });
  });

  it("revierte todo el lote si una unidad falla", async () => {
    const packageId = await createPackage();
    const events = [event(packageId), event(packageId, randomUUID())];

    await expect(
      db.query(`SELECT public.commit_package_changes($1::jsonb, 1, null)`, [JSON.stringify(events)]),
    ).rejects.toMatchObject({ code: "23503" });

    const snapshot = await db.query<{ items: number; events: number; version: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.package_items WHERE package_id = '${packageId}') AS items,
        (SELECT count(*)::int FROM private.domain_events WHERE package_id = '${packageId}') AS events,
        (SELECT version FROM public.packages WHERE id = '${packageId}') AS version
    `);
    expect(snapshot.rows[0]).toEqual({ events: 0, items: 0, version: 1 });
  });

  it("rechaza lotes vacíos, demasiado grandes, ids inválidos y versiones obsoletas", async () => {
    const packageId = await createPackage();
    const call = (events: unknown, version = 1) =>
      db.query(`SELECT public.commit_package_changes($1::jsonb, $2, null)`, [JSON.stringify(events), version]);

    await expect(call([])).rejects.toThrow(/event.invalid/);
    await expect(call(Array.from({ length: 101 }, () => event(packageId)))).rejects.toThrow(/event.invalid/);
    await expect(call([{ ...event(packageId), packageId: "not-a-uuid" }])).rejects.toThrow(/event.invalid/);
    await expect(call([{ ...event(packageId), packageId: undefined }])).rejects.toThrow(/event.invalid/);
    await expect(call([event(packageId)], 2)).rejects.toThrow(/package.version_conflict/);
  });

  it("rechaza eventos mezclados sin dejar escrituras", async () => {
    const packageId = await createPackage();
    const otherPackageId = await createPackage();

    await expect(
      db.query(`SELECT public.commit_package_changes($1::jsonb, 1, null)`, [
        JSON.stringify([event(packageId), event(otherPackageId)]),
      ]),
    ).rejects.toThrow(/event.invalid/);

    const items = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.package_items WHERE package_id = $1`,
      [packageId],
    );
    expect(items.rows[0].count).toBe(0);
  });
});
