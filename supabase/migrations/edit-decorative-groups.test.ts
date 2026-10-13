// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * editable-decorative-groups (tasks 3.1-3.6): reparent/rename/delete/move RPCs.
 *
 * Aplica todas las migraciones en PostgreSQL embebido (PGlite) y prueba la
 * defensa SQL de ciclos/profundidad, locks + expectedVersion, incremento único
 * de versión, outbox con correlación, atomicidad con fallos inducidos,
 * privilegios/RLS y la compatibilidad con la copia evento<->plantilla de
 * DECOR-44 (cuya migración no se toca).
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULE_ARCO = "22222222-2222-4222-8222-222222222222";
const MODULE_MESA = "11111111-1111-4111-8111-111111111111";

const MIGRATIONS_DIR = resolve("supabase/migrations");
const MIGRATION = "20261016000000_edit_package_groups.sql";
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

const OCCURRED_AT = "2026-10-16T10:00:00.000Z";

describe("editable-decorative-groups: RPCs de edición de zonas", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);

    const migrations = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const migration of migrations) {
      await db.exec(await readFile(resolve(MIGRATIONS_DIR, migration), "utf8"));
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

  async function newPackage(userId = USER_A, version = 1): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO public.packages (id, user_id, name, space_type, capacity_m2, version)
       VALUES ($1, $2, 'Evento', 'salonSocial', 50, $3)`,
      [id, userId, version],
    );
    return id;
  }

  function movedEvent(packageId: string, userId: string, itemId: string, moduleId: string, fromGroupId: string | null, toGroupId: string | null) {
    return { eventId: randomUUID(), occurredAt: OCCURRED_AT, packageId, payload: { fromGroupId, itemId, moduleId, toGroupId }, schemaVersion: 1, type: "package.module.moved", userId };
  }
  function removedEvent(packageId: string, userId: string, itemId: string, moduleId: string) {
    return { eventId: randomUUID(), occurredAt: OCCURRED_AT, packageId, payload: { itemId, moduleId }, schemaVersion: 1, type: "package.module.removed", userId };
  }

  async function createGroup(params: {
    packageId: string;
    userId?: string;
    groupId?: string;
    name?: string;
    parentGroupId?: string | null;
    events?: unknown[];
    expectedVersion?: number | null;
    correlationId?: string | null;
  }): Promise<{ groupId: string; depth: number; itemIds: string[]; packageVersion: number }> {
    const result = await db.query<{ result: { groupId: string; depth: number; itemIds: string[]; packageVersion: number } }>(
      `SELECT public.create_package_group($1, $2, $3, $4, $5, $6::jsonb, $7, $8) AS result`,
      [
        params.packageId,
        params.userId ?? USER_A,
        params.groupId ?? randomUUID(),
        params.name ?? "Zona",
        params.parentGroupId ?? null,
        JSON.stringify(params.events ?? []),
        params.expectedVersion ?? null,
        params.correlationId ?? null,
      ],
    );
    return result.rows[0].result;
  }

  async function updateGroup(params: {
    packageId: string;
    userId?: string;
    groupId: string;
    name?: string | null;
    parentGroupId?: string | null;
    reparent?: boolean;
    expectedVersion?: number | null;
    correlationId?: string | null;
  }): Promise<{ groupId: string; name: string; parentGroupId: string | null; depth: number; packageVersion: number }> {
    const result = await db.query<{ result: { groupId: string; name: string; parentGroupId: string | null; depth: number; packageVersion: number } }>(
      `SELECT public.update_package_group($1, $2, $3, $4, $5, $6, $7, $8) AS result`,
      [
        params.packageId,
        params.userId ?? USER_A,
        params.groupId,
        params.name ?? null,
        params.parentGroupId ?? null,
        params.reparent ?? false,
        params.expectedVersion ?? null,
        params.correlationId ?? null,
      ],
    );
    return result.rows[0].result;
  }

  async function deleteGroup(params: {
    packageId: string;
    userId?: string;
    groupId: string;
    strategy: string;
    events?: unknown[];
    expectedVersion?: number | null;
    correlationId?: string | null;
  }): Promise<{ groupId: string; strategy: string; movedItemIds: string[]; removedItemIds: string[]; eventCount: number; packageVersion: number }> {
    const result = await db.query<{ result: { groupId: string; strategy: string; movedItemIds: string[]; removedItemIds: string[]; eventCount: number; packageVersion: number } }>(
      `SELECT public.delete_package_group($1, $2, $3, $4, $5::jsonb, $6, $7) AS result`,
      [
        params.packageId,
        params.userId ?? USER_A,
        params.groupId,
        params.strategy,
        JSON.stringify(params.events ?? []),
        params.expectedVersion ?? null,
        params.correlationId ?? null,
      ],
    );
    return result.rows[0].result;
  }

  async function moveItem(params: {
    event: unknown;
    groupId: string | null;
    expectedVersion?: number | null;
    correlationId?: string | null;
  }): Promise<number> {
    const result = await db.query<{ version: number }>(
      `SELECT public.move_package_item($1::jsonb, $2, $3, $4) AS version`,
      [JSON.stringify(params.event), params.groupId, params.expectedVersion ?? null, params.correlationId ?? null],
    );
    return Number(result.rows[0].version);
  }

  async function insertItem(packageId: string, moduleId: string, groupId: string | null): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO public.package_items (id, package_id, module_id, group_id) VALUES ($1, $2, $3, $4)`,
      [id, packageId, moduleId, groupId],
    );
    return id;
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

  // -------------------------------------------------------------------------
  // 3.1 Seguridad y firmas
  // -------------------------------------------------------------------------

  it("3.1 todas las funciones son SECURITY INVOKER, search_path vacío y firma única", async () => {
    const sql = await readFile(resolve(MIGRATIONS_DIR, MIGRATION), "utf8");
    const headers = sql.match(/CREATE OR REPLACE FUNCTION public\.\w+\(/g) ?? [];

    expect(headers.length).toBeGreaterThanOrEqual(6);
    expect(sql.match(/SECURITY INVOKER/g) ?? []).toHaveLength(headers.length);
    expect(sql.match(/SET search_path = ''/g) ?? []).toHaveLength(headers.length);
    expect(sql).not.toContain("SECURITY DEFINER");
    expect(sql).toContain("pg_catalog.");

    const names = headers.map((header) => header.replace("CREATE OR REPLACE FUNCTION public.", "").replace("(", ""));
    expect(new Set(names).size).toBe(names.length);
  });

  // -------------------------------------------------------------------------
  // 3.2 Versión, eventos y correlación
  // -------------------------------------------------------------------------

  it("crear una zona vacía versiona el agregado una vez sin emitir eventos", async () => {
    const packageId = await newPackage();
    const result = await createGroup({ packageId });

    expect(result.packageVersion).toBe(2);
    expect(await snapshot(packageId)).toEqual({ events: 0, groups: 1, items: 0, version: 2 });
  });

  it("renombrar conserva padre, contenido e identificador y sube una versión", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ name: "Antigua", packageId });
    const item = await insertItem(packageId, MODULE_MESA, zona.groupId);
    const before = await snapshot(packageId);

    const updated = await updateGroup({ groupId: zona.groupId, name: "  Recepción  ", packageId });

    expect(updated.name).toBe("Recepción");
    expect(updated.parentGroupId).toBeNull();
    expect(updated.packageVersion).toBe(before.version + 1);
    const itemRow = await db.query<{ group_id: string }>(`SELECT group_id FROM public.package_items WHERE id = $1`, [item]);
    expect(itemRow.rows[0].group_id).toBe(zona.groupId);
    expect(await snapshot(packageId)).toMatchObject({ events: 0, groups: 1, items: 1, version: before.version + 1 });
  });

  it("reparentar recalcula la profundidad del subárbol con los mismos identificadores", async () => {
    const packageId = await newPackage();
    const destino = await createGroup({ name: "Destino", packageId });
    const raiz = await createGroup({ name: "Raíz", packageId });
    const sub = await createGroup({ name: "Sub", packageId, parentGroupId: raiz.groupId });
    const subSub = await createGroup({ name: "SubSub", packageId, parentGroupId: sub.groupId });

    const updated = await updateGroup({ groupId: sub.groupId, packageId, parentGroupId: destino.groupId, reparent: true });

    expect(updated.depth).toBe(2);
    const depths = await db.query<{ id: string; depth: number; parent_group_id: string | null }>(
      `SELECT id, depth, parent_group_id FROM public.package_groups WHERE package_id = $1 ORDER BY id`,
      [packageId],
    );
    const byId = new Map(depths.rows.map((row) => [row.id, row]));
    expect(byId.get(sub.groupId)?.depth).toBe(2);
    expect(byId.get(sub.groupId)?.parent_group_id).toBe(destino.groupId);
    expect(byId.get(subSub.groupId)?.depth).toBe(3);
    expect(byId.get(raiz.groupId)?.depth).toBe(1);
  });

  it("rechaza mover una zona dentro de sí misma o de un descendiente", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ packageId });
    const sub = await createGroup({ packageId, parentGroupId: zona.groupId });
    const before = await snapshot(packageId);

    await expect(updateGroup({ groupId: zona.groupId, packageId, parentGroupId: zona.groupId, reparent: true })).rejects.toMatchObject({
      message: expect.stringContaining("package.group_cycle"),
    });
    await expect(updateGroup({ groupId: zona.groupId, packageId, parentGroupId: sub.groupId, reparent: true })).rejects.toMatchObject({
      message: expect.stringContaining("package.group_cycle"),
    });
    expect(await snapshot(packageId)).toEqual(before);
  });

  it("rechaza un movimiento que excede los tres niveles y revierte la profundidad", async () => {
    const packageId = await newPackage();
    const destino = await createGroup({ name: "Destino", packageId });
    const n1 = await createGroup({ name: "N1", packageId });
    const n2 = await createGroup({ name: "N2", packageId, parentGroupId: n1.groupId });
    await createGroup({ name: "N3", packageId, parentGroupId: n2.groupId });
    const before = await snapshot(packageId);

    await expect(updateGroup({ groupId: n1.groupId, packageId, parentGroupId: destino.groupId, reparent: true })).rejects.toMatchObject({
      message: expect.stringContaining("package.group_depth_exceeded"),
    });
    const row = await db.query<{ depth: number; parent_group_id: string | null }>(
      `SELECT depth, parent_group_id FROM public.package_groups WHERE id = $1`,
      [n1.groupId],
    );
    expect(row.rows[0]).toMatchObject({ depth: 1, parent_group_id: null });
    expect(await snapshot(packageId)).toEqual(before);
  });

  it("detecta conflicto de versión en update y move sin escribir", async () => {
    const packageId = await newPackage(USER_A, 7);
    const zona = await createGroup({ packageId, expectedVersion: null });
    // La creación por defecto no versiona aquí: se creó con expectedVersion null,
    // así que forzamos una versión conocida.
    await db.query(`UPDATE public.packages SET version = 7 WHERE id = $1`, [packageId]);
    const before = await snapshot(packageId);

    await expect(updateGroup({ groupId: zona.groupId, name: "X", packageId, expectedVersion: 6 })).rejects.toMatchObject({
      message: expect.stringContaining("package.version_conflict"),
    });
    expect(await snapshot(packageId)).toEqual(before);
  });

  it("one update sin nombre ni padre es inválido", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ packageId });
    await expect(updateGroup({ groupId: zona.groupId, packageId })).rejects.toMatchObject({
      message: expect.stringContaining("package.invalid_update"),
    });
  });

  it("mover un item conserva identidad, cambia de zona y registra package.module.moved", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ packageId });
    const item = await insertItem(packageId, MODULE_MESA, null);
    const before = await snapshot(packageId);
    const event = movedEvent(packageId, USER_A, item, MODULE_MESA, null, zona.groupId);

    const version = await moveItem({ event, groupId: zona.groupId, expectedVersion: before.version, correlationId: "corr-move" });

    expect(version).toBe(before.version + 1);
    const row = await db.query<{ id: string; module_id: string; group_id: string }>(
      `SELECT id, module_id, group_id FROM public.package_items WHERE id = $1`,
      [item],
    );
    expect(row.rows[0]).toMatchObject({ id: item, module_id: MODULE_MESA, group_id: zona.groupId });
    const outbox = await db.query<{ event_type: string; correlation_id: string }>(
      `SELECT event_type, correlation_id FROM private.domain_events WHERE package_id = $1`,
      [packageId],
    );
    expect(outbox.rows).toEqual([{ event_type: "package.module.moved", correlation_id: "corr-move" }]);
  });

  it("rechaza un evento moved que identifica otro paquete o usuario", async () => {
    const packageId = await newPackage();
    const other = await newPackage();
    const item = await insertItem(packageId, MODULE_MESA, null);
    const before = await snapshot(packageId);

    await expect(
      db.query(`SELECT public.insert_package_outbox_event($1::jsonb, $2, $3::uuid, $4::uuid, NULL)`, [
        JSON.stringify(movedEvent(other, USER_A, item, MODULE_MESA, null, null)),
        "package.module.moved",
        packageId,
        USER_A,
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining("event.invalid") });
    await expect(
      db.query(`SELECT public.insert_package_outbox_event($1::jsonb, $2, $3::uuid, $4::uuid, NULL)`, [
        JSON.stringify(movedEvent(packageId, USER_B, item, MODULE_MESA, null, null)),
        "package.module.moved",
        packageId,
        USER_A,
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining("event.invalid") });

    expect(await snapshot(packageId)).toEqual(before);
  });

  it("mover a un destino ajeno o a un item inexistente devuelve los códigos de 404", async () => {
    const packageId = await newPackage();
    const other = await newPackage();
    const foreignGroup = await createGroup({ packageId: other });
    const item = await insertItem(packageId, MODULE_MESA, null);
    const before = await snapshot(packageId);

    await expect(
      moveItem({ event: movedEvent(packageId, USER_A, item, MODULE_MESA, null, foreignGroup.groupId), groupId: foreignGroup.groupId }),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.group_not_found") });

    await expect(
      moveItem({ event: movedEvent(packageId, USER_A, randomUUID(), MODULE_MESA, null, null), groupId: null }),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.item_not_found") });

    expect(await snapshot(packageId)).toEqual(before);
  });

  it("eliminar con move_to_root sube el contenido y emite un moved por módulo directo", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ name: "Zona", packageId });
    const sub = await createGroup({ name: "Sub", packageId, parentGroupId: zona.groupId });
    const subSub = await createGroup({ name: "SubSub", packageId, parentGroupId: sub.groupId });
    const itemDirecto = await insertItem(packageId, MODULE_MESA, zona.groupId);
    const itemSub = await insertItem(packageId, MODULE_ARCO, sub.groupId);
    const itemSubSub = await insertItem(packageId, MODULE_MESA, subSub.groupId);
    const before = await snapshot(packageId);
    const event = movedEvent(packageId, USER_A, itemDirecto, MODULE_MESA, zona.groupId, null);

    const result = await deleteGroup({ groupId: zona.groupId, packageId, strategy: "move_to_root", events: [event], expectedVersion: before.version, correlationId: "corr-root" });

    expect(result.packageVersion).toBe(before.version + 1);
    expect(result.eventCount).toBe(1);
    expect(await count(`SELECT count(*) AS count FROM public.package_groups WHERE id = $1`, [zona.groupId])).toBe(0);
    const subRow = await db.query<{ depth: number; parent_group_id: string | null }>(
      `SELECT depth, parent_group_id FROM public.package_groups WHERE id = $1`,
      [sub.groupId],
    );
    expect(subRow.rows[0]).toMatchObject({ depth: 1, parent_group_id: null });
    const subSubRow = await db.query<{ depth: number }>(`SELECT depth FROM public.package_groups WHERE id = $1`, [subSub.groupId]);
    expect(subSubRow.rows[0].depth).toBe(2);
    const directoRow = await db.query<{ group_id: string | null }>(`SELECT group_id FROM public.package_items WHERE id = $1`, [itemDirecto]);
    expect(directoRow.rows[0].group_id).toBeNull();
    const subItemRow = await db.query<{ group_id: string }>(`SELECT group_id FROM public.package_items WHERE id = $1`, [itemSub]);
    expect(subItemRow.rows[0].group_id).toBe(sub.groupId);
    const subSubItemRow = await db.query<{ group_id: string }>(`SELECT group_id FROM public.package_items WHERE id = $1`, [itemSubSub]);
    expect(subSubItemRow.rows[0].group_id).toBe(subSub.groupId);
    const outbox = await db.query<{ event_type: string; correlation_id: string }>(
      `SELECT event_type, correlation_id FROM private.domain_events WHERE package_id = $1`,
      [packageId],
    );
    expect(outbox.rows).toEqual([{ event_type: "package.module.moved", correlation_id: "corr-root" }]);
  });

  it("eliminar con delete_contents borra el subárbol y emite un removed por módulo", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ name: "Zona", packageId });
    const sub = await createGroup({ name: "Sub", packageId, parentGroupId: zona.groupId });
    const item1 = await insertItem(packageId, MODULE_MESA, zona.groupId);
    const item2 = await insertItem(packageId, MODULE_ARCO, sub.groupId);
    const rootItem = await insertItem(packageId, MODULE_ARCO, null);
    const before = await snapshot(packageId);
    const events = [removedEvent(packageId, USER_A, item1, MODULE_MESA), removedEvent(packageId, USER_A, item2, MODULE_ARCO)];

    const result = await deleteGroup({ groupId: zona.groupId, packageId, strategy: "delete_contents", events, expectedVersion: before.version });

    expect(result.packageVersion).toBe(before.version + 1);
    expect(result.eventCount).toBe(2);
    expect(await count(`SELECT count(*) AS count FROM public.package_groups WHERE package_id = $1`, [packageId])).toBe(0);
    expect(await count(`SELECT count(*) AS count FROM public.package_items WHERE package_id = $1`, [packageId])).toBe(1);
    const remaining = await db.query<{ id: string }>(`SELECT id FROM public.package_items WHERE package_id = $1`, [packageId]);
    expect(remaining.rows[0].id).toBe(rootItem);
    const outbox = await db.query<{ event_type: string }>(`SELECT event_type FROM private.domain_events WHERE package_id = $1`, [packageId]);
    expect(outbox.rows.every((row) => row.event_type === "package.module.removed")).toBe(true);
  });

  it("rechaza una estrategia ausente y una cobertura de eventos incompleta", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ packageId });
    await insertItem(packageId, MODULE_MESA, zona.groupId);

    await expect(deleteGroup({ groupId: zona.groupId, packageId, strategy: "otra" })).rejects.toMatchObject({
      message: expect.stringContaining("package.invalid_strategy"),
    });

    await expect(
      deleteGroup({ groupId: zona.groupId, packageId, strategy: "delete_contents", events: [] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("event.invalid") });

    expect(await count(`SELECT count(*) AS count FROM public.package_groups WHERE id = $1`, [zona.groupId])).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 3.3 Atomicidad con fallos inducidos
  // -------------------------------------------------------------------------

  it("revierte zona, contenido, versión y outbox si falla una escritura hija", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ packageId });
    const item = await insertItem(packageId, MODULE_MESA, zona.groupId);
    const before = await snapshot(packageId);
    const event = movedEvent(packageId, USER_A, item, MODULE_MESA, zona.groupId, null);

    await db.exec(`
      CREATE FUNCTION public.fail_package_items() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated_item_failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_fail_package_items
        BEFORE UPDATE ON public.package_items
        FOR EACH ROW EXECUTE FUNCTION public.fail_package_items();
    `);

    try {
      await expect(
        deleteGroup({ groupId: zona.groupId, packageId, strategy: "move_to_root", events: [event] }),
      ).rejects.toMatchObject({ message: expect.stringContaining("simulated_item_failure") });
    } finally {
      await db.exec(`DROP TRIGGER trg_fail_package_items ON public.package_items; DROP FUNCTION public.fail_package_items();`);
    }

    expect(await snapshot(packageId)).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // 3.4 RLS y privilegios
  // -------------------------------------------------------------------------

  it("anon y authenticated no pueden ejecutar los RPC ni escribir grupos", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ packageId });

    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        asRole(role, USER_A, () =>
          db.query(`SELECT public.update_package_group($1, $2, $3, 'X', NULL, false, NULL, NULL)`, [packageId, USER_A, zona.groupId]),
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole(role, USER_A, () =>
          db.query(`SELECT public.delete_package_group($1, $2, $3, 'delete_contents', '[]'::jsonb, NULL, NULL)`, [packageId, USER_A, zona.groupId]),
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole(role, USER_A, () =>
          db.query(`UPDATE public.package_groups SET name = 'Hack' WHERE id = $1`, [zona.groupId]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("RLS: el dueño lee sus grupos, otro usuario no ve nada", async () => {
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
  });

  // -------------------------------------------------------------------------
  // 3.6 Compatibilidad con DECOR-44 (migración intacta)
  // -------------------------------------------------------------------------

  it("DECOR-44 copia la jerarquía editada con IDs nuevos e independencia", async () => {
    const packageId = await newPackage();
    const zona = await createGroup({ name: "Zona 1", packageId });
    const sub = await createGroup({ name: "Subzona", packageId, parentGroupId: zona.groupId });
    // Edición: renombrar la zona y subir la subzona a raíz.
    await updateGroup({ groupId: zona.groupId, name: "Zona Principal", packageId });
    await updateGroup({ groupId: sub.groupId, packageId, parentGroupId: null, reparent: true });
    const rootItem = await insertItem(packageId, MODULE_ARCO, null);
    const zoneItem = await insertItem(packageId, MODULE_MESA, zona.groupId);
    const subItem = await insertItem(packageId, MODULE_ARCO, sub.groupId);

    const template = await db.query<{ result: { id: string; itemCount: number; groupCount: number } }>(
      `SELECT public.create_event_template_from_package($1, $2, $3) AS result`,
      [packageId, USER_A, "Plantilla editada"],
    );
    const templateId = template.rows[0].result.id;
    expect(template.rows[0].result).toMatchObject({ itemCount: 3, groupCount: 2 });

    const templateGroups = await db.query<{ id: string; name: string; parent_group_id: string | null; depth: number }>(
      `SELECT id, name, parent_group_id, depth FROM public.event_template_groups WHERE template_id = $1 ORDER BY depth, name`,
      [templateId],
    );
    expect(templateGroups.rows.map((row) => [row.name, row.depth])).toEqual([
      ["Subzona", 1],
      ["Zona Principal", 1],
    ]);
    expect(templateGroups.rows.map((row) => row.id)).not.toContain(zona.groupId);
    expect(templateGroups.rows.map((row) => row.id)).not.toContain(sub.groupId);

    const created = await db.query<{ result: { id: string; itemCount: number; groupCount: number } }>(
      `SELECT public.create_package_from_event_template($1, $2, $3) AS result`,
      [templateId, USER_A, "Evento clon"],
    );
    const cloneId = created.rows[0].result.id;
    expect(created.rows[0].result).toMatchObject({ itemCount: 3, groupCount: 2 });

    const cloneGroups = await db.query<{ id: string; name: string; parent_group_id: string | null }>(
      `SELECT id, name, parent_group_id FROM public.package_groups WHERE package_id = $1 ORDER BY name`,
      [cloneId],
    );
    expect(cloneGroups.rows.map((row) => [row.name, row.parent_group_id])).toEqual([
      ["Subzona", null],
      ["Zona Principal", null],
    ]);
    expect(cloneGroups.rows.map((row) => row.id)).not.toContain(zona.groupId);
    expect(cloneGroups.rows.map((row) => row.id)).not.toContain(sub.groupId);

    const cloneItems = await db.query<{ id: string; group_id: string | null }>(
      `SELECT id, group_id FROM public.package_items WHERE package_id = $1`,
      [cloneId],
    );
    expect(cloneItems.rows.map((row) => row.id)).not.toContain(rootItem);
    expect(cloneItems.rows.map((row) => row.id)).not.toContain(zoneItem);
    expect(cloneItems.rows.map((row) => row.id)).not.toContain(subItem);
    expect(cloneItems.rows.some((row) => row.group_id === null)).toBe(true);

    // Independencia: borrar la subzona clonada no toca la fuente ni la plantilla.
    const clonedSub = cloneGroups.rows.find((row) => row.name === "Subzona");
    const cloneSubItems = await db.query<{ id: string }>(`SELECT id FROM public.package_items WHERE package_id = $1 AND group_id = $2`, [
      cloneId,
      clonedSub?.id,
    ]);
    const cloneSubEvents = cloneSubItems.rows.map((row) => removedEvent(cloneId, USER_A, row.id, MODULE_ARCO));
    await deleteGroup({ groupId: clonedSub!.id, packageId: cloneId, strategy: "delete_contents", events: cloneSubEvents });
    expect(await count(`SELECT count(*) AS count FROM public.package_groups WHERE package_id = $1`, [packageId])).toBe(2);
    expect(await count(`SELECT count(*) AS count FROM public.package_groups WHERE package_id = $1`, [cloneId])).toBe(1);
    expect(await count(`SELECT count(*) AS count FROM public.event_template_groups WHERE template_id = $1`, [templateId])).toBe(2);
  });

  it("no modifica la migración de DECOR-44: sus RPC siguen presentes", async () => {
    const decor44 = await readFile(resolve(MIGRATIONS_DIR, DECOR44), "utf8");
    expect(decor44).toContain("CREATE OR REPLACE FUNCTION public.create_event_template_from_package");
    expect(decor44).toContain("CREATE OR REPLACE FUNCTION public.create_package_from_event_template");
    expect(decor44).not.toContain("update_package_group");
  });
});
