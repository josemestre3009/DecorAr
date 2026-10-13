// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DECOR-44: eventos con metadatos opcionales y plantillas privadas.
 *
 * Aplica todas las migraciones en PostgreSQL embebido (PGlite) y prueba:
 * migración aditiva + backfill determinista, nulabilidad e integridad de
 * packages, RLS/privilegios de las tablas de plantilla, copia profunda
 * evento<->plantilla con IDs nuevos, jerarquía, independencia y rollback.
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULE_MESA = "11111111-1111-4111-8111-111111111111";
const MODULE_ARCO = "22222222-2222-4222-8222-222222222222";

const MIGRATIONS_DIR = resolve("supabase/migrations");
const DECOR44 = "20261015000000_event_templates_and_metadata.sql";

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

async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
}

async function applyMigrations(db: PGlite, options: { skip?: string } = {}): Promise<void> {
  for (const file of await migrationFiles()) {
    if (options.skip && file === options.skip) continue;
    await db.exec(await readFile(resolve(MIGRATIONS_DIR, file), "utf8"));
  }
}

async function asRole<T>(
  db: PGlite,
  role: "anon" | "authenticated",
  userId: string | null,
  run: () => Promise<T>,
): Promise<T> {
  await db.exec(`SET ROLE ${role};`);
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  try {
    return await run();
  } finally {
    await db.exec("RESET ROLE;");
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query<{ count: string | number }>(sql, params);
  return Number(result.rows[0].count);
}

describe("DECOR-44 migración: metadatos de evento y backfill", () => {
  let db: PGlite;
  const legacyId = randomUUID();

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');`);
    // Everything before DECOR-44, so a legacy row can be written without `name`.
    await applyMigrations(db, { skip: DECOR44 });

    await db.query(
      `INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version)
       VALUES ($1, $2, 'casa', 30, 1)`,
      [legacyId, USER_A],
    );

    await db.exec(await readFile(resolve(MIGRATIONS_DIR, DECOR44), "utf8"));
  });

  afterAll(async () => {
    await db?.close();
  });

  it("backfillea un nombre determinista y legible para filas existentes", async () => {
    const result = await db.query<{ name: string }>(
      `SELECT name FROM public.packages WHERE id = $1`,
      [legacyId],
    );
    expect(result.rows[0].name).toBe(`Evento ${legacyId.slice(0, 8)}`);
  });

  it("es idempotente: reaplicar no cambia nombres existentes", async () => {
    const before = await db.query<{ name: string }>(`SELECT name FROM public.packages WHERE id = $1`, [
      legacyId,
    ]);

    await db.exec(await readFile(resolve(MIGRATIONS_DIR, DECOR44), "utf8"));

    const after = await db.query<{ name: string }>(`SELECT name FROM public.packages WHERE id = $1`, [
      legacyId,
    ]);
    expect(after.rows[0].name).toBe(before.rows[0].name);
  });

  it("name es NOT NULL y space_type/capacity_m2 quedan nullables", async () => {
    const columns = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'packages'
         AND column_name IN ('name', 'space_type', 'capacity_m2', 'client_name', 'event_date', 'venue', 'event_type')`,
    );
    const byName = new Map(columns.rows.map((row) => [row.column_name, row.is_nullable]));
    expect(byName.get("name")).toBe("NO");
    expect(byName.get("space_type")).toBe("YES");
    expect(byName.get("capacity_m2")).toBe("YES");
    expect(byName.get("client_name")).toBe("YES");
    expect(byName.get("event_date")).toBe("YES");
    expect(byName.get("venue")).toBe("YES");
    expect(byName.get("event_type")).toBe("YES");
  });

  it("acepta un evento sin datos espaciales y sigue rechazando valores inválidos", async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO public.packages (id, user_id, name, version) VALUES ($1, $2, 'Solo nombre', 1)`,
      [id, USER_A],
    );

    await expect(
      db.query(`INSERT INTO public.packages (user_id, name, space_type) VALUES ($1, 'X', 'invalido')`, [
        USER_A,
      ]),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      db.query(`INSERT INTO public.packages (user_id, name, capacity_m2) VALUES ($1, 'X', 0)`, [USER_A]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("create_package exige nombre y admite metadatos opcionales", async () => {
    const minimal = await db.query<{ result: { id: string; name: string; spaceType: null } }>(
      `SELECT public.create_package($1, $2) AS result`,
      [USER_A, "  Cumpleaños  "],
    );
    expect(minimal.rows[0].result.name).toBe("Cumpleaños");
    expect(minimal.rows[0].result.spaceType).toBeNull();

    const full = await db.query<{ result: { name: string; venue: string; eventDate: string } }>(
      `SELECT public.create_package($1, $2, 'salonSocial', 80, 'Ana', '2026-11-01', 'Club', 'boda') AS result`,
      [USER_A, "Boda Ana"],
    );
    expect(full.rows[0].result.name).toBe("Boda Ana");
    expect(full.rows[0].result.venue).toBe("Club");
    expect(full.rows[0].result.eventDate).toBe("2026-11-01");

    await expect(
      db.query(`SELECT public.create_package($1, NULL)`, [USER_A]),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.invalid_name") });
    await expect(
      db.query(`SELECT public.create_package($1, 'X', 'invalido')`, [USER_A]),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.invalid_space_type") });
    await expect(
      db.query(`SELECT public.create_package($1, 'X', NULL, -5)`, [USER_A]),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.invalid_capacity") });
  });
});

describe("DECOR-44: plantillas privadas, RLS y copia profunda", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);
    await applyMigrations(db);

    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
      INSERT INTO public.catalog_modules (
        id, asset_id, version, name, price_cop, area_m2, width_m, height_m, depth_m,
        glb_url, usdz_url, poster_url, status
      ) VALUES
      ('${MODULE_MESA}', 'mesa-test', 1, 'Mesa redonda', 250000, 4, 2, 1, 2,
       'https://example.com/m.glb', 'https://example.com/m.usdz', null, 'active'),
      ('${MODULE_ARCO}', 'arco-test', 1, 'Arco floral', 200000, 2, 2, 2, 1,
       'https://example.com/a.glb', 'https://example.com/a.usdz', null, 'active');
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedEvent(userId = USER_A) {
    const packageId = randomUUID();
    await db.query(
      `INSERT INTO public.packages (
         id, user_id, name, space_type, capacity_m2, event_type, style, colors, notes,
         client_name, event_date, venue, version
       ) VALUES ($1, $2, 'Evento origen', 'salonSocial', 80, 'boda', 'elegante',
                 '["#fff","#000"]'::jsonb, 'Notas del evento', 'Ana', '2026-11-01', 'Club', 1)`,
      [packageId, userId],
    );

    const group1 = randomUUID();
    await db.query(
      `INSERT INTO public.package_groups (id, package_id, parent_group_id, name, depth)
       VALUES ($1, $2, NULL, 'Zona de bienvenida', 1)`,
      [group1, packageId],
    );
    const group2 = randomUUID();
    await db.query(
      `INSERT INTO public.package_groups (id, package_id, parent_group_id, name, depth)
       VALUES ($1, $2, $3, 'Mesa de regalos', 1)`,
      [group2, packageId, group1],
    );

    const itemIds = { root: randomUUID(), g1: randomUUID(), g2: randomUUID() };
    await db.query(
      `INSERT INTO public.package_items (id, package_id, module_id, group_id) VALUES
         ($1, $2, $3, NULL),
         ($4, $2, $5, $6),
         ($7, $2, $3, $8)`,
      [itemIds.root, packageId, MODULE_ARCO, itemIds.g1, MODULE_MESA, group1, itemIds.g2, group2],
    );

    return { packageId, group1, group2, itemIds };
  }

  async function createTemplate(sourcePackageId: string, name = "Plantilla base", owner = USER_A) {
    const result = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.create_event_template_from_package($1, $2, $3) AS result`,
      [sourcePackageId, owner, name],
    );
    return result.rows[0].result;
  }

  it("copia profunda evento->plantilla con IDs nuevos, jerarquía y preferencias", async () => {
    const source = await seedEvent();
    const template = (await createTemplate(source.packageId, "Boda base")) as {
      id: string;
      name: string;
      spaceType: string;
      capacityM2: number;
      eventType: string;
      style: string;
      colors: string[];
      notes: string;
      itemCount: number;
      groupCount: number;
    };

    expect(template.name).toBe("Boda base");
    expect(template.spaceType).toBe("salonSocial");
    expect(Number(template.capacityM2)).toBe(80);
    expect(template.eventType).toBe("boda");
    expect(template.style).toBe("elegante");
    expect(template.colors).toEqual(["#fff", "#000"]);
    expect(template.notes).toBe("Notas del evento");
    expect(template.itemCount).toBe(3);
    expect(template.groupCount).toBe(2);

    // La plantilla no tiene columnas de cliente/fecha/lugar.
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'event_templates'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain("client_name");
    expect(names).not.toContain("event_date");
    expect(names).not.toContain("venue");

    // Grupos: nuevos ids, jerarquía conservada por nombre y profundidad.
    const groups = await db.query<{ id: string; parent_group_id: string | null; name: string; depth: number }>(
      `SELECT id, parent_group_id, name, depth FROM public.event_template_groups
       WHERE template_id = $1 ORDER BY depth, name`,
      [template.id],
    );
    expect(groups.rows.map((g) => [g.name, g.depth])).toEqual([
      ["Zona de bienvenida", 1],
      ["Mesa de regalos", 2],
    ]);
    const [newG1, newG2] = groups.rows;
    expect([newG1.id, newG2.id]).not.toContain(source.group1);
    expect([newG1.id, newG2.id]).not.toContain(source.group2);
    expect(newG2.parent_group_id).toBe(newG1.id);

    // Ítems: nuevos ids, mismos módulos del catálogo y mismo grupo relativo.
    const items = await db.query<{ id: string; module_id: string; group_id: string | null }>(
      `SELECT id, module_id, group_id FROM public.event_template_items WHERE template_id = $1`,
      [template.id],
    );
    expect(items.rows).toHaveLength(3);
    expect(items.rows.some((row) => row.id === source.itemIds.root)).toBe(false);
    expect(items.rows.some((row) => row.id === source.itemIds.g1)).toBe(false);
    expect(new Set(items.rows.map((row) => row.module_id))).toEqual(
      new Set([MODULE_ARCO, MODULE_MESA]),
    );
    expect(items.rows.find((row) => row.module_id === MODULE_MESA && row.group_id === newG1.id)).toBeDefined();
    expect(items.rows.find((row) => row.module_id === MODULE_ARCO && row.group_id === newG2.id)).toBeDefined();
    expect(items.rows.some((row) => row.group_id === null)).toBe(true);

    // El evento origen queda intacto.
    expect(await count(db, `SELECT count(*) AS count FROM public.package_items WHERE package_id = $1`, [source.packageId])).toBe(3);
    expect(await count(db, `SELECT count(*) AS count FROM public.package_groups WHERE package_id = $1`, [source.packageId])).toBe(2);
  });

  it("copia profunda plantilla->evento sin cliente, fecha ni lugar", async () => {
    const source = await seedEvent();
    const template = (await createTemplate(source.packageId, "Boda base")) as { id: string };

    const result = await db.query<{
      result: { id: string; name: string; clientName: null; eventDate: null; venue: null; itemCount: number; groupCount: number };
    }>(`SELECT public.create_package_from_event_template($1, $2, $3) AS result`, [
      template.id,
      USER_A,
      "Nuevo evento",
    ]);
    const created = result.rows[0].result;
    expect(created.name).toBe("Nuevo evento");
    expect(created.clientName).toBeNull();
    expect(created.eventDate).toBeNull();
    expect(created.venue).toBeNull();
    expect(created.itemCount).toBe(3);
    expect(created.groupCount).toBe(2);

    const row = await db.query<{ client_name: string | null; event_date: string | null; venue: string | null; space_type: string; capacity_m2: string }>(
      `SELECT client_name, event_date, venue, space_type, capacity_m2 FROM public.packages WHERE id = $1`,
      [created.id],
    );
    expect(row.rows[0]).toMatchObject({ client_name: null, event_date: null, venue: null, space_type: "salonSocial", capacity_m2: "80.00" });

    const groups = await db.query<{ id: string; depth: number }>(
      `SELECT id, depth FROM public.event_template_groups WHERE template_id = $1 ORDER BY depth`,
      [template.id],
    );
    const copiedGroups = await db.query<{ id: string; depth: number }>(
      `SELECT id, depth FROM public.package_groups WHERE package_id = $1 ORDER BY depth`,
      [created.id],
    );
    expect(copiedGroups.rows.map((g) => g.depth)).toEqual(groups.rows.map((g) => g.depth));
    expect(copiedGroups.rows.some((g) => groups.rows.some((t) => t.id === g.id))).toBe(false);
  });

  it("la independencia se mantiene al modificar o eliminar la plantilla", async () => {
    const source = await seedEvent();
    const template = (await createTemplate(source.packageId, "Base")) as { id: string };
    const created = await db.query<{ result: { id: string } }>(
      `SELECT public.create_package_from_event_template($1, $2, 'Clon') AS result`,
      [template.id, USER_A],
    );
    const eventId = created.rows[0].result.id;

    const renamed = await db.query<{ result: { name: string } }>(
      `SELECT public.rename_event_template($1, $2, 'Base renombrada') AS result`,
      [template.id, USER_A],
    );
    expect(renamed.rows[0].result.name).toBe("Base renombrada");

    await db.query(`SELECT public.delete_event_template($1, $2)`, [template.id, USER_A]);
    expect(await count(db, `SELECT count(*) AS count FROM public.event_templates WHERE id = $1`, [template.id])).toBe(0);
    expect(await count(db, `SELECT count(*) AS count FROM public.event_template_groups WHERE template_id = $1`, [template.id])).toBe(0);

    // El evento creado desde la plantilla sigue completo.
    expect(await count(db, `SELECT count(*) AS count FROM public.package_items WHERE package_id = $1`, [eventId])).toBe(3);
    expect(await count(db, `SELECT count(*) AS count FROM public.package_groups WHERE package_id = $1`, [eventId])).toBe(2);
  });

  it("rechaza plantilla ajena o inexistente como template.not_found", async () => {
    const source = await seedEvent(USER_B);
    const template = (await createTemplate(source.packageId, "De B", USER_B)) as { id: string };

    await expect(
      db.query(`SELECT public.create_package_from_event_template($1, $2, 'X')`, [template.id, USER_A]),
    ).rejects.toMatchObject({ message: expect.stringContaining("template.not_found") });
    await expect(
      db.query(`SELECT public.rename_event_template($1, $2, 'X')`, [template.id, USER_A]),
    ).rejects.toMatchObject({ message: expect.stringContaining("template.not_found") });
    await expect(
      db.query(`SELECT public.delete_event_template($1, $2)`, [template.id, USER_A]),
    ).rejects.toMatchObject({ message: expect.stringContaining("template.not_found") });

    // Guardar como plantilla un evento ajeno tampoco revela que existe.
    await expect(
      db.query(`SELECT public.create_event_template_from_package($1, $2, 'X')`, [source.packageId, USER_A]),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.not_found") });
  });

  it("revierte la copia evento->plantilla si falla una escritura hija", async () => {
    const source = await seedEvent();
    const before = await count(db, `SELECT count(*) AS count FROM public.event_templates WHERE owner_id = $1`, [USER_A]);

    await db.exec(`
      CREATE FUNCTION fail_template_items() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated_template_failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_fail_template_items
        BEFORE INSERT ON public.event_template_items
        FOR EACH ROW EXECUTE FUNCTION fail_template_items();
    `);

    try {
      await expect(
        db.query(`SELECT public.create_event_template_from_package($1, $2, 'Falla')`, [source.packageId, USER_A]),
      ).rejects.toMatchObject({ message: expect.stringContaining("simulated_template_failure") });
    } finally {
      await db.exec(`DROP TRIGGER trg_fail_template_items ON public.event_template_items; DROP FUNCTION fail_template_items();`);
    }

    expect(await count(db, `SELECT count(*) AS count FROM public.event_templates WHERE owner_id = $1`, [USER_A])).toBe(before);
    expect(await count(db, `SELECT count(*) AS count FROM public.package_items WHERE package_id = $1`, [source.packageId])).toBe(3);
  });

  it("revierte la copia plantilla->evento si falla una escritura hija", async () => {
    const source = await seedEvent();
    const template = (await createTemplate(source.packageId, "Base")) as { id: string };
    const before = await count(db, `SELECT count(*) AS count FROM public.packages`);

    await db.exec(`
      CREATE FUNCTION fail_package_items() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated_package_failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_fail_package_items
        BEFORE INSERT ON public.package_items
        FOR EACH ROW EXECUTE FUNCTION fail_package_items();
    `);

    try {
      await expect(
        db.query(`SELECT public.create_package_from_event_template($1, $2, 'Falla')`, [template.id, USER_A]),
      ).rejects.toMatchObject({ message: expect.stringContaining("simulated_package_failure") });
    } finally {
      await db.exec(`DROP TRIGGER trg_fail_package_items ON public.package_items; DROP FUNCTION fail_package_items();`);
    }

    expect(await count(db, `SELECT count(*) AS count FROM public.packages`)).toBe(before);
  });

  it("clone_package sigue funcionando con name NOT NULL y campos nullables", async () => {
    const source = await seedEvent();
    const cloned = await db.query<{ result: { id: string; name: string; clientName: string; itemCount: number; groupCount: number } }>(
      `SELECT public.clone_package($1, $2) AS result`,
      [source.packageId, USER_A],
    );
    const clone = cloned.rows[0].result;
    expect(clone.id).not.toBe(source.packageId);
    expect(clone.name).toBe("Evento origen");
    expect(clone.clientName).toBe("Ana");
    expect(clone.itemCount).toBe(3);
    expect(clone.groupCount).toBe(2);
  });

  it("RLS: el dueño ve sus plantillas, otro usuario no ve nada, anon no tiene acceso", async () => {
    const source = await seedEvent(USER_A);
    const template = (await createTemplate(source.packageId, "Privada", USER_A)) as { id: string };

    const owner = await asRole(db, "authenticated", USER_A, () =>
      db.query(`SELECT id FROM public.event_templates WHERE id = $1`, [template.id]),
    );
    expect(owner.rows).toHaveLength(1);

    const other = await asRole(db, "authenticated", USER_B, () =>
      db.query(`SELECT id FROM public.event_templates WHERE id = $1`, [template.id]),
    );
    expect(other.rows).toHaveLength(0);

    await expect(
      asRole(db, "anon", null, () => db.query(`SELECT id FROM public.event_templates`)),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("anon y authenticated no pueden escribir ni ejecutar los RPC de plantilla", async () => {
    const source = await seedEvent(USER_A);

    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        asRole(db, role, USER_A, () =>
          db.query(`INSERT INTO public.event_templates (owner_id, name) VALUES ($1, 'X')`, [USER_A]),
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole(db, role, USER_A, () =>
          db.query(`SELECT public.create_event_template_from_package($1, $2, 'X')`, [source.packageId, USER_A]),
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole(db, role, USER_A, () =>
          db.query(`SELECT public.create_package_from_event_template($1, $2, 'X')`, [randomUUID(), USER_A]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
