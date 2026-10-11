// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PACKAGE_A = "11111111-1111-4111-8111-111111111111";
const MODULE_A = "c1000000-0000-4000-8000-000000000001";

// Same minimal shim as DECOR-30/32/33's executable policy tests: roles,
// auth.uid() and the realtime schema the earlier migrations reference.
const supabaseShim = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;

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

let itemCounter = 0;

function makeEvent(overrides: { eventId?: string } = {}): { eventId: string } & Record<string, unknown> {
  itemCounter += 1;
  const itemId = `99999999-${itemCounter.toString().padStart(4, "0")}-4999-8999-999999999999`;

  return {
    eventId: overrides.eventId ?? "11111111-aaaa-4aaa-8aaa-000000000001",
    occurredAt: "2026-10-11T00:00:00.000Z",
    packageId: PACKAGE_A,
    payload: { itemId, moduleId: MODULE_A },
    schemaVersion: 1,
    type: "package.module.added",
    userId: USER_A,
  };
}

describe("DECOR-31 async recovery SQL migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);

    const directory = resolve("supabase/migrations");
    const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const migration of migrations) await db.exec(await readFile(resolve(directory, migration), "utf8"));

    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_A}');
      INSERT INTO public.packages (id, user_id) VALUES ('${PACKAGE_A}', '${USER_A}');
      INSERT INTO public.catalog_modules (id, asset_id, version, name, area_m2, price_cop, status, glb_url, usdz_url, width_m, height_m, depth_m)
      VALUES ('${MODULE_A}', 'test-asset', 1, 'Módulo de prueba', 1, 100000, 'active', 'https://example.com/a.glb', 'https://example.com/a.usdz', 1, 1, 1);
    `);
  }, 30_000);

  afterAll(async () => db?.close());

  async function asRole<T extends Record<string, unknown>>(
    role: "anon" | "authenticated" | "service_role",
    sql: string,
    params: unknown[] = [],
  ) {
    await db.exec(`SET ROLE ${role};`);
    try {
      return await db.query<T>(sql, params);
    } finally {
      await db.exec("RESET ROLE");
    }
  }

  async function commit(event: Record<string, unknown>, expectedVersion: number | null = null, correlationId: string | null = null) {
    return asRole<{ commit_package_change: number }>(
      "service_role",
      "SELECT public.commit_package_change($1, $2, $3) AS commit_package_change",
      [event, expectedVersion, correlationId],
    );
  }

  it("stores correlationId on commit and keeps it readable by listing functions", async () => {
    const event = makeEvent({ eventId: "33333333-aaaa-4aaa-8aaa-000000000003" });
    await commit(event, 1, "corr-xyz");

    const row = await asRole<{ event_id: string; correlation_id: string }>(
      "service_role",
      "SELECT event_id, correlation_id FROM private.domain_events WHERE event_id = $1",
      [event.eventId],
    );

    expect(row.rows).toEqual([{ correlation_id: "corr-xyz", event_id: event.eventId }]);
  });

  it("defaults correlationId to null when not given, keeping the two-argument call usable", async () => {
    const event = makeEvent({ eventId: "44444444-aaaa-4aaa-8aaa-000000000004" });
    await asRole("service_role", "SELECT public.commit_package_change($1, $2)", [event, 2]);

    const row = await asRole<{ correlation_id: string | null }>(
      "service_role",
      "SELECT correlation_id FROM private.domain_events WHERE event_id = $1",
      [event.eventId],
    );

    expect(row.rows).toEqual([{ correlation_id: null }]);
  });

  it("claim_retry_domain_event only advances attempts when they match the expected value", async () => {
    const event = makeEvent({ eventId: "55555555-aaaa-4aaa-8aaa-000000000005" });
    await commit(event, 3, "corr-retry");
    // Simulate the initial drain attempt having already happened.
    await db.exec(
      `UPDATE private.domain_events SET attempts = 1 WHERE event_id = '${event.eventId}'`,
    );

    const matching = await asRole<{ event_id: string; attempts: number; correlation_id: string }>(
      "service_role",
      "SELECT * FROM public.claim_retry_domain_event($1, $2)",
      [event.eventId, 1],
    );
    expect(matching.rows).toEqual([
      expect.objectContaining({ attempts: 2, correlation_id: "corr-retry", event_id: event.eventId }),
    ]);

    // A second claim for the same (now stale) expected attempts reclaims nothing.
    const stale = await asRole(
      "service_role",
      "SELECT * FROM public.claim_retry_domain_event($1, $2)",
      [event.eventId, 1],
    );
    expect(stale.rows).toEqual([]);
  });

  it("list_retryable_domain_events only returns pending events with 1 to 3 attempts", async () => {
    const neverAttempted = makeEvent({ eventId: "66666666-aaaa-4aaa-8aaa-000000000006" });
    const oneAttempt = makeEvent({ eventId: "77777777-aaaa-4aaa-8aaa-000000000007" });
    const exhausted = makeEvent({ eventId: "88888888-aaaa-4aaa-8aaa-000000000008" });

    await commit(neverAttempted, 4);
    await commit(oneAttempt, 5);
    await commit(exhausted, 6);
    await db.exec(`UPDATE private.domain_events SET attempts = 1 WHERE event_id = '${oneAttempt.eventId}'`);
    await db.exec(
      `UPDATE private.domain_events SET attempts = 4, status = 'failed' WHERE event_id = '${exhausted.eventId}'`,
    );

    const retryable = await asRole<{ event_id: string }>(
      "service_role",
      "SELECT event_id FROM public.list_retryable_domain_events(100)",
    );

    const ids = retryable.rows.map((r) => r.event_id);
    expect(ids).toContain(oneAttempt.eventId);
    expect(ids).not.toContain(neverAttempted.eventId);
    expect(ids).not.toContain(exhausted.eventId);
  });

  it("mark_domain_event_failed moves a pending event to failed and it stops being retryable", async () => {
    const event = makeEvent({ eventId: "99999999-aaaa-4aaa-8aaa-000000000009" });
    await commit(event, 7);
    await db.exec(`UPDATE private.domain_events SET attempts = 4 WHERE event_id = '${event.eventId}'`);

    const marked = await asRole<{ mark_domain_event_failed: boolean }>(
      "service_role",
      "SELECT public.mark_domain_event_failed($1, $2) AS mark_domain_event_failed",
      [event.eventId, "exhausted after 3 retries"],
    );
    expect(marked.rows).toEqual([{ mark_domain_event_failed: true }]);

    const row = await asRole<{ status: string; last_error: string }>(
      "service_role",
      "SELECT status, last_error FROM private.domain_events WHERE event_id = $1",
      [event.eventId],
    );
    expect(row.rows).toEqual([{ last_error: "exhausted after 3 retries", status: "failed" }]);

    const stillRetryable = await asRole<{ event_id: string }>(
      "service_role",
      "SELECT event_id FROM public.list_retryable_domain_events(100) WHERE event_id = $1",
      [event.eventId],
    );
    expect(stillRetryable.rows).toEqual([]);

    // Marking it failed again reports false: it is no longer pending.
    const second = await asRole<{ mark_domain_event_failed: boolean }>(
      "service_role",
      "SELECT public.mark_domain_event_failed($1, $2) AS mark_domain_event_failed",
      [event.eventId, "again"],
    );
    expect(second.rows).toEqual([{ mark_domain_event_failed: false }]);
  });

  it("list_unresolved_domain_events surfaces pending and failed events", async () => {
    const pending = makeEvent({ eventId: "aaaaaaaa-bbbb-4bbb-8bbb-00000000000a" });
    await commit(pending, 8);

    const unresolved = await asRole<{ event_id: string; status: string }>(
      "service_role",
      "SELECT event_id, status FROM public.list_unresolved_domain_events(500)",
    );

    const byId = new Map(unresolved.rows.map((r) => [r.event_id, r.status]));
    expect(byId.get(pending.eventId)).toBe("pending");
  });

  it("reconcile_budget creates the row on first call and reports corrected=false on an identical second call", async () => {
    const first = await asRole<{ corrected: boolean; total_cop: number; package_version: number }>(
      "service_role",
      "SELECT * FROM public.reconcile_budget($1, $2, $3)",
      [PACKAGE_A, 1, 100000],
    );
    expect(first.rows).toEqual([
      expect.objectContaining({ corrected: true, package_version: 1, total_cop: 100000 }),
    ]);

    const replay = await asRole<{ corrected: boolean }>(
      "service_role",
      "SELECT * FROM public.reconcile_budget($1, $2, $3)",
      [PACKAGE_A, 1, 100000],
    );
    expect(replay.rows).toEqual([expect.objectContaining({ corrected: false })]);
  });

  it("reconcile_budget corrects a drifted total for the same packageVersion, unlike process_budget_event", async () => {
    const corrected = await asRole<{ corrected: boolean; total_cop: number }>(
      "service_role",
      "SELECT * FROM public.reconcile_budget($1, $2, $3)",
      [PACKAGE_A, 1, 250000],
    );

    expect(corrected.rows).toEqual([expect.objectContaining({ corrected: true, total_cop: 250000 })]);
  });

  it("reconcile_budget advances on a strictly newer packageVersion", async () => {
    const corrected = await asRole<{ corrected: boolean; package_version: number; total_cop: number }>(
      "service_role",
      "SELECT * FROM public.reconcile_budget($1, $2, $3)",
      [PACKAGE_A, 2, 300000],
    );

    expect(corrected.rows).toEqual([
      expect.objectContaining({ corrected: true, package_version: 2, total_cop: 300000 }),
    ]);
  });

  it("rejects an invalid packageVersion or total before writing anything", async () => {
    await expect(
      asRole("service_role", "SELECT * FROM public.reconcile_budget($1, $2, $3)", [PACKAGE_A, 0, 100]),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.invalid_version") });

    await expect(
      asRole("service_role", "SELECT * FROM public.reconcile_budget($1, $2, $3)", [PACKAGE_A, 1, -1]),
    ).rejects.toMatchObject({ message: expect.stringContaining("budget.invalid_total") });
  });

  it("denies every new function to anon and authenticated", async () => {
    const privileges = await db.query<{ claim_retry: boolean; list_retryable: boolean; mark_failed: boolean; list_unresolved: boolean; reconcile: boolean }>(`
      SELECT
        has_function_privilege('authenticated', 'public.claim_retry_domain_event(text,integer)', 'EXECUTE') AS claim_retry,
        has_function_privilege('authenticated', 'public.list_retryable_domain_events(integer)', 'EXECUTE') AS list_retryable,
        has_function_privilege('authenticated', 'public.mark_domain_event_failed(text,text)', 'EXECUTE') AS mark_failed,
        has_function_privilege('authenticated', 'public.list_unresolved_domain_events(integer)', 'EXECUTE') AS list_unresolved,
        has_function_privilege('authenticated', 'public.reconcile_budget(uuid,integer,bigint)', 'EXECUTE') AS reconcile
    `);

    expect(privileges.rows).toEqual([
      { claim_retry: false, list_retryable: false, list_unresolved: false, mark_failed: false, reconcile: false },
    ]);

    await expect(
      asRole("anon", "SELECT public.reconcile_budget($1, $2, $3)", [PACKAGE_A, 1, 1]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps only one overload of commit_package_change reachable (the three-parameter one)", async () => {
    const overloads = await db.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_proc
      WHERE proname = 'commit_package_change' AND pronamespace = 'public'::regnamespace
    `);

    expect(overloads.rows).toEqual([{ count: "1" }]);
  });

  it("status check now accepts failed in addition to pending and published", async () => {
    const sql = await readFile(resolve("supabase/migrations/20261011000001_async_recovery.sql"), "utf8");
    expect(sql).toContain("CHECK (status IN ('pending', 'published', 'failed'))");
  });

  it("declares every new function SECURITY INVOKER with an empty search_path", async () => {
    const sql = await readFile(resolve("supabase/migrations/20261011000001_async_recovery.sql"), "utf8");
    const definitions = [
      ...sql.split("CREATE FUNCTION").slice(1),
      ...sql.split("CREATE OR REPLACE FUNCTION").slice(1),
    ];

    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition).toContain("SECURITY INVOKER");
      expect(definition).toContain("SET search_path = ''");
    }
    expect(sql).not.toContain("SECURITY DEFINER");
  });
});
