// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PACKAGE_A = "11111111-1111-4111-8111-111111111111";
const PACKAGE_B = "22222222-2222-4222-8222-222222222222";

// Same minimal shim as DECOR-30's executable policy test: roles, auth.uid()
// and the realtime schema the earlier migration references.
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

describe("DECOR-33 process_budget_event and budgets/processed_events policies", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);

    const directory = resolve("supabase/migrations");
    const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const migration of migrations) await db.exec(await readFile(resolve(directory, migration), "utf8"));

    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
      INSERT INTO public.packages (id, user_id) VALUES
        ('${PACKAGE_A}', '${USER_A}'), ('${PACKAGE_B}', '${USER_B}');
    `);
  }, 30_000);

  afterAll(async () => db?.close());

  async function asRole<T extends Record<string, unknown>>(
    role: "anon" | "authenticated" | "service_role",
    userId: string | null,
    sql: string,
    params: unknown[] = [],
  ) {
    await db.exec(`SET ROLE ${role};`);
    if (userId !== null) {
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
    }
    try {
      return await db.query<T>(sql, params);
    } finally {
      await db.exec("RESET ROLE");
    }
  }

  async function callProcessBudgetEvent(args: {
    consumer: string;
    eventId: string;
    packageId: string;
    packageVersion: number;
    totalCop: number;
  }) {
    return asRole<{
      applied: boolean;
      package_id: string;
      total_cop: number;
      package_version: number;
      updated_at: string;
    }>(
      "service_role",
      null,
      "SELECT * FROM public.process_budget_event($1, $2, $3, $4, $5)",
      [args.consumer, args.eventId, args.packageId, args.packageVersion, args.totalCop],
    );
  }

  it("applies the first event and creates the budget row", async () => {
    const result = await callProcessBudgetEvent({
      consumer: "budget",
      eventId: "evt-1",
      packageId: PACKAGE_A,
      packageVersion: 2,
      totalCop: 450000,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ applied: true, package_id: PACKAGE_A, total_cop: 450000, package_version: 2 }),
    ]);
  });

  it("a repeated eventId does not recalculate and reports applied=false", async () => {
    const result = await callProcessBudgetEvent({
      consumer: "budget",
      eventId: "evt-1",
      packageId: PACKAGE_A,
      packageVersion: 5,
      totalCop: 999999,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ applied: false, total_cop: 450000, package_version: 2 }),
    ]);
  });

  it("a new eventId with an out-of-order packageVersion is recorded but does not move the total", async () => {
    const result = await callProcessBudgetEvent({
      consumer: "budget",
      eventId: "evt-old",
      packageId: PACKAGE_A,
      packageVersion: 1,
      totalCop: 1,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ applied: false, total_cop: 450000, package_version: 2 }),
    ]);

    // Recorded as processed: replaying it again still reports applied=false,
    // never retried as if it were new.
    const replay = await callProcessBudgetEvent({
      consumer: "budget",
      eventId: "evt-old",
      packageId: PACKAGE_A,
      packageVersion: 1,
      totalCop: 1,
    });
    expect(replay.rows).toEqual([expect.objectContaining({ applied: false })]);
  });

  it("applies a strictly newer packageVersion", async () => {
    const result = await callProcessBudgetEvent({
      consumer: "budget",
      eventId: "evt-2",
      packageId: PACKAGE_A,
      packageVersion: 3,
      totalCop: 700000,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ applied: true, total_cop: 700000, package_version: 3 }),
    ]);
  });

  it("different consumers may reuse the same eventId", async () => {
    const result = await callProcessBudgetEvent({
      consumer: "other-consumer",
      eventId: "evt-1",
      packageId: PACKAGE_B,
      packageVersion: 1,
      totalCop: 100,
    });

    expect(result.rows).toEqual([expect.objectContaining({ applied: true, package_id: PACKAGE_B })]);
  });

  it("lets the owner read their own budget, denies the foreign user and anonymous", async () => {
    const own = await asRole<{ package_id: string }>(
      "authenticated",
      USER_A,
      `SELECT package_id FROM public.budgets WHERE package_id = '${PACKAGE_A}'`,
    );
    const foreign = await asRole<{ package_id: string }>(
      "authenticated",
      USER_B,
      `SELECT package_id FROM public.budgets WHERE package_id = '${PACKAGE_A}'`,
    );

    expect(own.rows).toEqual([{ package_id: PACKAGE_A }]);
    expect(foreign.rows).toEqual([]);
    await expect(asRole("anon", null, "SELECT package_id FROM public.budgets")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("denies any direct write to budgets from authenticated or anon", async () => {
    await expect(
      asRole(
        "authenticated",
        USER_A,
        `UPDATE public.budgets SET total_cop = 0 WHERE package_id = '${PACKAGE_A}'`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asRole("anon", null, `INSERT INTO public.budgets (package_id, total_cop, package_version) VALUES ('${PACKAGE_A}', 0, 1)`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps processed_events unreadable and unwritable for anon and authenticated", async () => {
    const privileges = await db.query<{ usage: boolean; select_priv: boolean; execute_priv: boolean }>(`
      SELECT
        has_schema_privilege('authenticated', 'private', 'USAGE') AS usage,
        has_table_privilege('authenticated', 'private.processed_events', 'SELECT') AS select_priv,
        has_function_privilege(
          'authenticated',
          'public.process_budget_event(text,text,uuid,integer,bigint)',
          'EXECUTE'
        ) AS execute_priv
    `);

    expect(privileges.rows).toEqual([{ usage: false, select_priv: false, execute_priv: false }]);

    await expect(
      asRole("authenticated", USER_A, "SELECT event_id FROM private.processed_events"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asRole("anon", null, "SELECT event_id FROM private.processed_events"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("acepta un total mayor que el máximo de integer de 32 bits", async () => {
    const result = await callProcessBudgetEvent({
      consumer: "budget",
      eventId: "evt-bigint",
      packageId: PACKAGE_A,
      packageVersion: 4,
      totalCop: 3000000000,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ applied: true, total_cop: 3000000000, package_version: 4 }),
    ]);
  });

  it("rejects invalid input before touching any table", async () => {
    await expect(
      callProcessBudgetEvent({ consumer: "", eventId: "x", packageId: PACKAGE_A, packageVersion: 1, totalCop: 0 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("budget.invalid_consumer") });

    await expect(
      callProcessBudgetEvent({ consumer: "budget", eventId: "", packageId: PACKAGE_A, packageVersion: 1, totalCop: 0 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("event.invalid") });

    await expect(
      callProcessBudgetEvent({ consumer: "budget", eventId: "evt-x", packageId: PACKAGE_A, packageVersion: 0, totalCop: 0 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.invalid_version") });

    await expect(
      callProcessBudgetEvent({ consumer: "budget", eventId: "evt-y", packageId: PACKAGE_A, packageVersion: 1, totalCop: -1 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("budget.invalid_total") });
  });
});
