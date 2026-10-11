// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DECOR-25: ejecuta todas las migraciones en PostgreSQL embebido y prueba la
 * defensa en base de datos del Composite: atomicidad, niveles, ciclos,
 * propiedad, RLS y clonación de grupos.
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULE_ARCO = "22222222-2222-4222-8222-222222222222";
const MODULE_MESA = "11111111-1111-4111-8111-111111111111";
const MODULE_INEXISTENTE = "99999999-9999-4999-8999-999999999999";

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

const MIGRATION = "20261012000000_create_package_groups.sql";

let db: PGlite;

function addedEvent(packageId: string, userId: string, moduleId: string, itemId = randomUUID()) {
  return {
    eventId: randomUUID(),
    occurredAt: "2026-10-12T10:00:00.000Z",
    packageId,
    payload: { itemId, moduleId },
    schemaVersion: 1,
    type: "package.module.added",
    userId,
  };
}

async function newPackage(userId = USER_A, version = 1): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version)
     VALUES ($1, $2, 'salonSocial', 50, $3)`,
    [id, userId, version],
  );
  return id;
}

type GroupResult = { groupId: string; depth: number; itemIds: string[]; packageVersion: number };

async function createGroup(params: {
  packageId: string;
  userId?: string;
  groupId?: string;
  name?: string;
  parentGroupId?: string | null;
  events?: unknown[];
  expectedVersion?: number | null;
}): Promise<GroupResult> {
  const result = await db.query<{ result: GroupResult }>(
    `SELECT public.create_package_group($1, $2, $3, $4, $5, $6::jsonb, $7) AS result`,
    [
      params.packageId,
      params.userId ?? USER_A,
      params.groupId ?? randomUUID(),
      params.name ?? "Zona de bienvenida",
      params.parentGroupId ?? null,
      JSON.stringify(params.events ?? []),
      params.expectedVersion ?? null,
    ],
  );
  return result.rows[0].result;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query<{ count: string | number }>(sql, params);
  return Number(result.rows[0].count);
}

async function snapshot(packageId: string) {
  return {
    events: await count(`SELECT count(*) AS count FROM private.domain_events WHERE package_id = $1`, [packageId]),
    groups: await count(`SELECT count(*) AS count FROM public.package_groups WHERE package_id = $1`, [packageId]),
    items: await count(`SELECT count(*) AS count FROM public.package_items WHERE package_id = $1`, [packageId]),
    version: await count(`SELECT version AS count FROM public.packages WHERE id = $1`, [packageId]),
  };
}

async function asRole<T>(role: "anon" | "authenticated", userId: string | null, run: () => Promise<T>) {
  await db.exec(`SET ROLE ${role};`);
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  try {
    return await run();
  } finally {
    await db.exec("RESET ROLE;");
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}

describe("DECOR-25 migración: grupos decorativos (Composite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);

    const directory = resolve("supabase/migrations");
    const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const migration of migrations) {
      await db.exec(await readFile(resolve(directory, migration), "utf8"));
    }

    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
      INSERT INTO public.catalog_modules (
        id, asset_id, version, name, price_cop, area_m2, width_m, height_m, depth_m,
        glb_url, usdz_url, poster_url, status
      ) VALUES
      ('${MODULE_ARCO}', 'arco-test', 1, 'Arco floral', 200000, 2, 2, 2, 1,
       'https://example.com/a.glb', 'https://example.com/a.usdz', null, 'active'),
      ('${MODULE_MESA}', 'mesa-test', 1, 'Mesa redonda', 250000, 4, 2, 1, 2,
       'https://example.com/m.glb', 'https://example.com/m.usdz', null, 'active');
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("todas las funciones nuevas son SECURITY INVOKER con search_path vacío", async () => {
    const sql = await readFile(resolve("supabase/migrations", MIGRATION), "utf8");
    const functions = sql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];

    expect(functions.length).toBeGreaterThanOrEqual(4);
    expect(sql.match(/SECURITY INVOKER/g)).toHaveLength(functions.length);
    expect(sql.match(/SET search_path = ''/g)).toHaveLength(functions.length);
    expect(sql).not.toContain("SECURITY DEFINER");
  });

  it("crea la Zona de bienvenida (arco + mesa) con sus hojas y un evento por hoja", async () => {
    const packageId = await newPackage();
    const arco = addedEvent(packageId, USER_A, MODULE_ARCO);
    const mesa = addedEvent(packageId, USER_A, MODULE_MESA);

    const result = await createGroup({ events: [arco, mesa], expectedVersion: 1, packageId });

    expect(result.depth).toBe(1);
    expect(result.itemIds).toEqual([arco.payload.itemId, mesa.payload.itemId]);
    expect(result.packageVersion).toBe(3); // una versión por hoja
    expect(await snapshot(packageId)).toEqual({ events: 2, groups: 1, items: 2, version: 3 });

    const items = await db.query<{ group_id: string }>(
      `SELECT group_id FROM public.package_items WHERE package_id = $1`,
      [packageId],
    );
    expect(items.rows.every((row) => row.group_id === result.groupId)).toBe(true);

    const types = await db.query<{ event_type: string }>(
      `SELECT event_type FROM private.domain_events WHERE package_id = $1`,
      [packageId],
    );
    expect(types.rows.map((row) => row.event_type)).toEqual(["package.module.added", "package.module.added"]);
  });

  it("un grupo sin hojas no emite eventos ni cambia la versión (no recalcula)", async () => {
    const packageId = await newPackage();

    const result = await createGroup({ packageId });

    expect(result.packageVersion).toBe(1);
    expect(result.itemIds).toEqual([]);
    expect(await snapshot(packageId)).toEqual({ events: 0, groups: 1, items: 0, version: 1 });
  });

  it("admite tres niveles y rechaza el cuarto sin dejar escrituras", async () => {
    const packageId = await newPackage();
    const nivel1 = await createGroup({ name: "Nivel 1", packageId });
    const nivel2 = await createGroup({ name: "Nivel 2", packageId, parentGroupId: nivel1.groupId });
    const nivel3 = await createGroup({ name: "Nivel 3", packageId, parentGroupId: nivel2.groupId });
    expect([nivel1.depth, nivel2.depth, nivel3.depth]).toEqual([1, 2, 3]);

    const before = await snapshot(packageId);
    await expect(
      createGroup({
        events: [addedEvent(packageId, USER_A, MODULE_MESA)],
        name: "Nivel 4",
        packageId,
        parentGroupId: nivel3.groupId,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.group_depth_exceeded") });
    expect(await snapshot(packageId)).toEqual(before);
  });

  it("si falla un hijo se revierte el grupo completo, las demás hojas y sus eventos", async () => {
    const packageId = await newPackage();
    const before = await snapshot(packageId);

    await expect(
      createGroup({
        events: [
          addedEvent(packageId, USER_A, MODULE_ARCO),
          addedEvent(packageId, USER_A, MODULE_INEXISTENTE),
        ],
        packageId,
      }),
    ).rejects.toMatchObject({ code: "23503" });

    expect(await snapshot(packageId)).toEqual(before);
  });

  it("un usuario ajeno no crea grupos en otro paquete", async () => {
    const packageId = await newPackage(USER_A);
    const before = await snapshot(packageId);

    await expect(createGroup({ packageId, userId: USER_B })).rejects.toMatchObject({
      message: expect.stringContaining("package.not_found"),
    });

    // Aunque el evento diga ser de A, el RPC exige que coincida con el usuario de la sesión.
    await expect(
      createGroup({ events: [addedEvent(packageId, USER_A, MODULE_MESA)], packageId, userId: USER_B }),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.not_found") });

    expect(await snapshot(packageId)).toEqual(before);
  });

  it("rechaza un evento que no corresponde al paquete o al usuario del grupo", async () => {
    const packageId = await newPackage(USER_A);
    const otherPackage = await newPackage(USER_A);

    await expect(
      createGroup({ events: [addedEvent(otherPackage, USER_A, MODULE_MESA)], packageId }),
    ).rejects.toMatchObject({ message: expect.stringContaining("event.invalid") });

    expect(await snapshot(packageId)).toMatchObject({ groups: 0, items: 0 });
    expect(await snapshot(otherPackage)).toMatchObject({ items: 0 });
  });

  it("rechaza un grupo padre de otro paquete", async () => {
    const packageA = await newPackage();
    const packageB = await newPackage();
    const groupInB = await createGroup({ packageId: packageB });

    await expect(createGroup({ packageId: packageA, parentGroupId: groupInB.groupId })).rejects.toMatchObject({
      message: expect.stringContaining("package.group_not_found"),
    });
  });

  it("detecta conflicto de versión antes de escribir", async () => {
    const packageId = await newPackage(USER_A, 5);

    await expect(createGroup({ expectedVersion: 4, packageId })).rejects.toMatchObject({
      message: expect.stringContaining("package.version_conflict"),
    });
    expect(await snapshot(packageId)).toMatchObject({ groups: 0, version: 5 });
  });

  it("la posición de un grupo es inmutable: no se puede formar un ciclo en la base", async () => {
    const packageId = await newPackage();
    const padre = await createGroup({ name: "Padre", packageId });
    const hijo = await createGroup({ name: "Hijo", packageId, parentGroupId: padre.groupId });

    await expect(
      db.query(`UPDATE public.package_groups SET parent_group_id = $1 WHERE id = $2`, [hijo.groupId, padre.groupId]),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.group_immutable") });

    await expect(
      db.query(
        `INSERT INTO public.package_groups (id, package_id, parent_group_id, name, depth)
         VALUES ($1, $2, $1, 'Propio padre', 1)`,
        [randomUUID(), packageId],
      ),
    ).rejects.toBeDefined();
  });

  it("agrega una hoja a un grupo existente; un grupo ajeno revierte la hoja y su evento", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ packageId });
    const event = addedEvent(packageId, USER_A, MODULE_MESA);

    const version = await db.query<{ version: number }>(
      `SELECT public.add_package_item_to_group($1::jsonb, $2, $3) AS version`,
      [JSON.stringify(event), zona.groupId, 1],
    );
    expect(version.rows[0].version).toBe(2);

    const item = await db.query<{ group_id: string }>(`SELECT group_id FROM public.package_items WHERE id = $1`, [
      event.payload.itemId,
    ]);
    expect(item.rows[0].group_id).toBe(zona.groupId);

    const otherPackage = await newPackage();
    const foreignGroup = await createGroup({ packageId: otherPackage });
    const before = await snapshot(packageId);

    await expect(
      db.query(`SELECT public.add_package_item_to_group($1::jsonb, $2, NULL)`, [
        JSON.stringify(addedEvent(packageId, USER_A, MODULE_ARCO)),
        foreignGroup.groupId,
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.group_not_found") });
    expect(await snapshot(packageId)).toEqual(before);
  });

  it("anon y authenticated no pueden ejecutar los RPC ni escribir grupos", async () => {
    const packageId = await newPackage();

    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        asRole(role, USER_A, () =>
          db.query(`SELECT public.create_package_group($1, $2, $3, 'X', NULL, '[]'::jsonb, NULL)`, [
            packageId,
            USER_A,
            randomUUID(),
          ]),
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole(role, USER_A, () =>
          db.query(`INSERT INTO public.package_groups (id, package_id, name, depth) VALUES ($1, $2, 'X', 1)`, [
            randomUUID(),
            packageId,
          ]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("RLS: el dueño ve sus grupos, otro usuario no ve nada y anon no tiene acceso", async () => {
    const packageId = await newPackage(USER_A);
    await createGroup({ packageId });

    const owner = await asRole("authenticated", USER_A, () =>
      db.query(`SELECT id FROM public.package_groups WHERE package_id = $1`, [packageId]),
    );
    expect(owner.rows).toHaveLength(1);

    const other = await asRole("authenticated", USER_B, () =>
      db.query(`SELECT id FROM public.package_groups WHERE package_id = $1`, [packageId]),
    );
    expect(other.rows).toHaveLength(0);

    await expect(
      asRole("anon", null, () => db.query(`SELECT id FROM public.package_groups`)),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("clone_package copia los grupos con ids nuevos y conserva la estructura", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({
      events: [addedEvent(packageId, USER_A, MODULE_ARCO), addedEvent(packageId, USER_A, MODULE_MESA)],
      packageId,
    });
    const sub = await createGroup({
      events: [addedEvent(packageId, USER_A, MODULE_MESA)],
      name: "Mesa de regalos",
      packageId,
      parentGroupId: zona.groupId,
    });
    await db.query(`SELECT public.commit_package_change($1::jsonb, NULL)`, [
      JSON.stringify(addedEvent(packageId, USER_A, MODULE_ARCO)),
    ]);

    const cloned = await db.query<{ result: { id: string; itemCount: number; groupCount: number } }>(
      `SELECT public.clone_package($1, $2) AS result`,
      [packageId, USER_A],
    );
    const clone = cloned.rows[0].result;
    expect(clone.itemCount).toBe(4);
    expect(clone.groupCount).toBe(2);

    const groups = await db.query<{ id: string; parent_group_id: string | null; name: string; depth: number }>(
      `SELECT id, parent_group_id, name, depth FROM public.package_groups WHERE package_id = $1 ORDER BY depth`,
      [clone.id],
    );
    expect(groups.rows.map((g) => [g.name, g.depth])).toEqual([
      ["Zona de bienvenida", 1],
      ["Mesa de regalos", 2],
    ]);
    const [newZona, newSub] = groups.rows;
    expect([newZona.id, newSub.id]).not.toContain(zona.groupId);
    expect(newSub.parent_group_id).toBe(newZona.id);

    const items = await db.query<{ group_id: string | null; total: string }>(
      `SELECT group_id, count(*) AS total FROM public.package_items WHERE package_id = $1 GROUP BY group_id`,
      [clone.id],
    );
    const byGroup = new Map(items.rows.map((row) => [row.group_id, Number(row.total)]));
    expect(byGroup.get(newZona.id)).toBe(2);
    expect(byGroup.get(newSub.id)).toBe(1);
    expect(byGroup.get(null)).toBe(1);

    // El original queda intacto.
    expect(await snapshot(packageId)).toMatchObject({ groups: 2, items: 4 });
    expect(sub.depth).toBe(2);
  });

  it("borrar un paquete elimina sus grupos e ítems en cascada", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ events: [addedEvent(packageId, USER_A, MODULE_MESA)], packageId });
    await createGroup({ packageId, parentGroupId: zona.groupId });

    await db.query(`DELETE FROM public.packages WHERE id = $1`, [packageId]);

    expect(await count(`SELECT count(*) AS count FROM public.package_groups WHERE package_id = $1`, [packageId])).toBe(0);
    expect(await count(`SELECT count(*) AS count FROM public.package_items WHERE package_id = $1`, [packageId])).toBe(0);
  });
});
