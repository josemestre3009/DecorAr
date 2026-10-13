// @vitest-environment node
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

    try {
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
    } catch (error) {
      await admin.auth.admin.deleteUser(created.data.user.id);
      throw error;
    }
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
    const channel = client.channel(`package:${packageId}`, { config: { private: true } });
    const status = await new Promise<string>((resolve) => {
      channel.subscribe((nextStatus) => {
        if (nextStatus !== "CLOSED") resolve(nextStatus);
      });
    });
    await client.removeChannel(channel);
    return status;
  }

  async function joinPublic(client: SupabaseClient, packageId: string): Promise<string> {
    const channel = client.channel(`public-check:${packageId}`);
    const status = await new Promise<string>((resolve) => {
      channel.subscribe((nextStatus) => {
        if (nextStatus !== "CLOSED") resolve(nextStatus);
      });
    });
    await client.removeChannel(channel);
    return status;
  }

  it("A se une a su canal privado; B y anónimo son rechazados", async () => {
    expect(await join(a.client, a.packageId)).toBe("SUBSCRIBED");
    expect(await join(b.client, a.packageId)).toBe("CHANNEL_ERROR");
    expect(await join(anon, a.packageId)).toBe("CHANNEL_ERROR");
  }, 30_000);

  it("A no puede publicar un budget falso en su propio canal", async () => {
    const channel = a.client.channel(`package:${a.packageId}`, { config: { private: true } });
    try {
      await a.client.realtime.setAuth();
      await expect(channel.httpSend("budget.recalculated", { totalCop: 1 })).rejects.not.toThrow(
        /requires Realtime server/,
      );
    } finally {
      await a.client.removeChannel(channel);
    }
  }, 30_000);

  it("el proyecto rechaza canales públicos", async () => {
    expect(await joinPublic(a.client, a.packageId)).toBe("CHANNEL_ERROR");
  }, 30_000);

  // --- DECOR-44: privacidad de plantillas ---------------------------------
  //
  // Las plantillas se crean con la RPC de service_role (el navegador nunca
  // escribe tablas de negocio). Después se comprueba la lectura por RLS, el
  // rechazo de escrituras directas y que los RPC de uso/renombrado/borrado
  // vuelven a validar la propiedad dentro de la transacción.

  async function seedTemplate(fixture: Fixture, name: string): Promise<string> {
    const created = await admin.rpc("create_event_template_from_package", {
      p_name: name,
      p_owner_id: fixture.id,
      p_source_package_id: fixture.packageId,
    });
    if (created.error) throw created.error;

    return (created.data as { id: string }).id;
  }

  it("A lee su plantilla, B no la ve y nadie escribe plantillas directamente", async () => {
    const templateId = await seedTemplate(a, `plantilla-a-${randomUUID()}`);

    const own = await a.client.from("event_templates").select("id").eq("id", templateId);
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ id: templateId }]);

    const foreign = await b.client.from("event_templates").select("id").eq("id", templateId);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);

    const anonRead = await anon.from("event_templates").select("id");
    expect(anonRead.error?.code).toBe("42501");

    const insert = await a.client.from("event_templates").insert({ name: "Directa", owner_id: a.id });
    const update = await a.client.from("event_templates").update({ name: "Directa" }).eq("owner_id", a.id);
    const remove = await a.client.from("event_templates").delete().eq("owner_id", a.id);

    expect(insert.error?.code).toBe("42501");
    expect(update.error?.code).toBe("42501");
    expect(remove.error?.code).toBe("42501");
  });

  it("B no puede usar, renombrar ni eliminar la plantilla de A", async () => {
    const templateId = await seedTemplate(a, `plantilla-b-${randomUUID()}`);

    const used = await admin.rpc("create_package_from_event_template", {
      p_event_name: "Intruso",
      p_owner_id: b.id,
      p_template_id: templateId,
    });
    const renamed = await admin.rpc("rename_event_template", {
      p_name: "Robada",
      p_owner_id: b.id,
      p_template_id: templateId,
    });
    const removed = await admin.rpc("delete_event_template", {
      p_owner_id: b.id,
      p_template_id: templateId,
    });

    expect(used.error?.message).toContain("template.not_found");
    expect(renamed.error?.message).toContain("template.not_found");
    expect(removed.error?.message).toContain("template.not_found");

    // La plantilla de A sigue intacta tras los intentos de B.
    const stillThere = await a.client.from("event_templates").select("id").eq("id", templateId);
    expect(stillThere.data).toEqual([{ id: templateId }]);
  });

  it("A usa, renombra y elimina su plantilla; el evento creado sobrevive sin cliente, fecha ni lugar", async () => {
    await admin
      .from("packages")
      .update({ client_name: "Ana", event_date: "2026-12-31", venue: "Salón X" })
      .eq("id", a.packageId);

    const templateId = await seedTemplate(a, `plantilla-uso-${randomUUID()}`);

    const renamed = await admin.rpc("rename_event_template", {
      p_name: "Plantilla renombrada",
      p_owner_id: a.id,
      p_template_id: templateId,
    });
    expect(renamed.error).toBeNull();
    expect((renamed.data as { name: string }).name).toBe("Plantilla renombrada");

    const used = await admin.rpc("create_package_from_event_template", {
      p_event_name: "Evento desde plantilla",
      p_owner_id: a.id,
      p_template_id: templateId,
    });
    expect(used.error).toBeNull();
    const created = used.data as {
      id: string;
      clientName: string | null;
      eventDate: string | null;
      venue: string | null;
    };
    // Identificador nuevo y sin los datos específicos del evento fuente.
    expect(created.id).not.toBe(a.packageId);
    expect(created.clientName).toBeNull();
    expect(created.eventDate).toBeNull();
    expect(created.venue).toBeNull();

    const removed = await admin.rpc("delete_event_template", {
      p_owner_id: a.id,
      p_template_id: templateId,
    });
    expect(removed.error).toBeNull();
    expect(removed.data).toBe(true);

    // Eliminar la plantilla no altera el evento que produjo.
    const survivor = await admin
      .from("packages")
      .select("id, client_name")
      .eq("id", created.id)
      .single<{ id: string; client_name: string | null }>();
    expect(survivor.error).toBeNull();
    expect(survivor.data).toEqual({ client_name: null, id: created.id });
  });
});
