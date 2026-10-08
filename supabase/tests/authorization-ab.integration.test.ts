/**
 * DECOR-30 fixtures A/B against the hosted Supabase project.
 *
 * Opt-in: runs only with DECOR_RLS_INTEGRATION=1 and the three Supabase
 * variables, because it creates real users. Users are created through the
 * admin API with `email_confirm: true` (same approach as DECOR-38, no
 * confirmation e-mail) and deleted at the end together with their packages.
 *
 *   DECOR_RLS_INTEGRATION=1 npx vitest run supabase/tests --environment node
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled = process.env.DECOR_RLS_INTEGRATION === "1" && Boolean(url && publishableKey && serviceRoleKey);

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };

type Fixture = { id: string; email: string; client: SupabaseClient; packageId: string };

describe.skipIf(!enabled)("DECOR-30 autorización A/B contra Supabase", () => {
  const admin = enabled ? createClient(url, serviceRoleKey, noSession) : (null as never);
  const anon = enabled ? createClient(url, publishableKey, noSession) : (null as never);
  const fixtures: Fixture[] = [];

  async function createFixture(label: string): Promise<Fixture> {
    const email = `decor30-${label}-${randomUUID()}@decorar.test`;
    const password = `${randomUUID()}Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;

    const client = createClient(url, publishableKey, noSession);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;

    const inserted = await admin
      .from("packages")
      .insert({ user_id: created.data.user.id })
      .select("id")
      .single<{ id: string }>();
    if (inserted.error) throw inserted.error;

    const fixture = { id: created.data.user.id, email, client, packageId: inserted.data.id };
    fixtures.push(fixture);
    return fixture;
  }

  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    a = await createFixture("a");
    b = await createFixture("b");
  }, 30_000);

  afterAll(async () => {
    for (const fixture of fixtures) {
      await fixture.client.removeAllChannels();
      await admin.from("packages").delete().eq("id", fixture.packageId);
      await admin.auth.admin.deleteUser(fixture.id);
    }
  }, 30_000);

  it("A lee su paquete", async () => {
    const { data, error } = await a.client.from("packages").select("id").eq("id", a.packageId);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: a.packageId }]);
  });

  it("B no ve el paquete de A", async () => {
    const { data, error } = await b.client.from("packages").select("id").eq("id", a.packageId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("anónimo no tiene permiso sobre packages", async () => {
    const { error } = await anon.from("packages").select("id");

    expect(error?.code).toBe("42501");
  });

  it("A no puede escribir su paquete ni la outbox directamente", async () => {
    const update = await a.client.from("packages").update({ version: 99 }).eq("id", a.packageId);
    const rpc = await a.client.rpc("commit_package_change", { p_event: {} });

    expect(update.error?.code).toBe("42501");
    expect(rpc.error).not.toBeNull();
  });

  async function join(client: SupabaseClient, packageId: string): Promise<string> {
    await client.realtime.setAuth();
    return new Promise((resolve) => {
      client
        .channel(`package:${packageId}`, { config: { private: true } })
        .subscribe((status) => {
          if (status !== "CLOSED") resolve(status);
        });
    });
  }

  it("A se une a su canal privado; B y anónimo son rechazados", async () => {
    expect(await join(a.client, a.packageId)).toBe("SUBSCRIBED");
    expect(await join(b.client, a.packageId)).toBe("CHANNEL_ERROR");
    expect(await join(anon, a.packageId)).toBe("CHANNEL_ERROR");
  }, 30_000);

  it("A no puede publicar un budget falso en su propio canal", async () => {
    const channel = a.client.channel(`package:${a.packageId}`, { config: { private: true } });
    const result = await channel.httpSend("budget.recalculated", { totalCop: 1 });

    expect(result.success).toBe(false);
  });
});
