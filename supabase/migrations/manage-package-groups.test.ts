// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DECOR-43: ejecuta todas las migraciones en PostgreSQL embebido y prueba el
 * renombrado y la eliminación de grupos: promoción del contenido al padre,
 * profundidades recalculadas, atomicidad, propiedad, versión y permisos.
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULE_ARCO = "22222222-2222-4222-8222-222222222222";
const MODULE_MESA = "11111111-1111-4111-8111-111111111111";

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

const MIGRATION = "20261015000000_manage_package_groups.sql";

let db: PGlite;

function addedEvent(packageId: string, moduleId: string, userId = USER_A) {
  return {
    eventId: randomUUID(),
    occurredAt: "2026-10-15T10:00:00.000Z",
    packageId,
    payload: { itemId: randomUUID(), moduleId },
    schemaVersion: 1,
    type: "package.module.added",
    userId,
  };
}

async function newPackage(userId = USER_A): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version)
     VALUES ($1, $2, 'salonSocial', 50, 1)`,
    [id, userId],
  );
  return id;
}

async function currentVersion(packageId: string): Promise<number> {
  const result = await db.query<{ version: number }>(`SELECT version FROM public.packages WHERE id = $1`, [
    packageId,
  ]);
  return result.rows[0].version;
}

/** Crea un grupo con `leaves` hojas (mesas) confirmadas en la misma transacción. */
async function createGroup(packageId: string, name: string, parentGroupId: string | null = null, leaves = 0) {
  const events = Array.from({ length: leaves }, () => addedEvent(packageId, MODULE_MESA));
  const result = await db.query<{ result: { groupId: string } }>(
    `SELECT public.create_package_group($1, $2, $3, $4, $5, $6::jsonb, NULL) AS result`,
    [packageId, USER_A, randomUUID(), name, parentGroupId, JSON.stringify(events)],
  );
  return result.rows[0].result.groupId;
}

async function renameGroup(packageId: string, groupId: string, name: string, userId = USER_A, version?: number) {
  const result = await db.query<{ result: { groupId: string; name: string; structureVersion: number } }>(
    `SELECT public.rename_package_group($1, $2, $3, $4, $5) AS result`,
    [packageId, userId, groupId, name, version ?? null],
  );
  return result.rows[0].result;
}

type DeletedGroup = {
  groupId: string;
  parentGroupId: string | null;
  promotedGroups: number;
  promotedItems: number;
  structureVersion: number;
};

async function deleteGroup(packageId: string, groupId: string, userId = USER_A, version?: number) {
  const result = await db.query<{ result: DeletedGroup }>(
    `SELECT public.delete_package_group($1, $2, $3, $4) AS result`,
    [packageId, userId, groupId, version ?? null],
  );
  return result.rows[0].result;
}

/** Foto completa del paquete: grupos, a qué grupo pertenece cada hoja, versiones y eventos. */
async function snapshot(packageId: string) {
  const groups = await db.query<{ id: string; name: string; parent_group_id: string | null; depth: number }>(
    `SELECT id, name, parent_group_id, depth FROM public.package_groups WHERE package_id = $1 ORDER BY id`,
    [packageId],
  );
  const items = await db.query<{ id: string; group_id: string | null }>(
    `SELECT id, group_id FROM public.package_items WHERE package_id = $1 ORDER BY id`,
    [packageId],
  );
  const pkg = await db.query<{ version: number; structure_version: number }>(
    `SELECT version, structure_version FROM public.packages WHERE id = $1`,
    [packageId],
  );
  const events = await db.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM private.domain_events WHERE package_id = $1`,
    [packageId],
  );
  return {
    events: Number(events.rows[0].count),
    groups: groups.rows,
    items: items.rows,
    structureVersion: pkg.rows[0].structure_version,
    version: pkg.rows[0].version,
  };
}

async function groupRow(groupId: string) {
  const result = await db.query<{ name: string; parent_group_id: string | null; depth: number }>(
    `SELECT name, parent_group_id, depth FROM public.package_groups WHERE id = $1`,
    [groupId],
  );
  return result.rows[0] ?? null;
}

async function itemsIn(packageId: string, groupId: string | null): Promise<number> {
  const result = await db.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM public.package_items
     WHERE package_id = $1 AND group_id IS NOT DISTINCT FROM $2`,
    [packageId, groupId],
  );
  return Number(result.rows[0].count);
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

describe("DECOR-43 migración: renombrar y eliminar grupos", () => {
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

  it("todas las funciones son SECURITY INVOKER con search_path vacío", async () => {
    const sql = await readFile(resolve("supabase/migrations", MIGRATION), "utf8");
    const functions = sql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];

    expect(functions).toHaveLength(3);
    expect(sql.match(/SECURITY INVOKER/g)).toHaveLength(functions.length);
    expect(sql.match(/SET search_path = ''/g)).toHaveLength(functions.length);
    expect(sql).not.toContain("SECURITY DEFINER");
  });

  it("los paquetes existentes y nuevos empiezan con structure_version 1", async () => {
    const packageId = await newPackage();
    expect(await snapshot(packageId)).toMatchObject({ structureVersion: 1, version: 1 });
  });

  describe("rename_package_group", () => {
    it("cambia solo el nombre (recortado) y sube la versión estructural, no la del paquete", async () => {
      const packageId = await newPackage();
      const sala = await createGroup(packageId, "Sala", null, 1);
      const mesa = await createGroup(packageId, "Mesa", sala, 1);
      const before = await snapshot(packageId);

      const renamed = await renameGroup(packageId, sala, "  Sala principal  ");

      expect(renamed).toEqual({ groupId: sala, name: "Sala principal", structureVersion: 2 });
      const after = await snapshot(packageId);
      expect(after.version).toBe(before.version);
      expect(after.events).toBe(before.events);
      expect(after.items).toEqual(before.items);
      expect(await groupRow(sala)).toEqual({ depth: 1, name: "Sala principal", parent_group_id: null });
      expect(await groupRow(mesa)).toEqual({ depth: 2, name: "Mesa", parent_group_id: sala });
    });

    it("rechaza nombres vacíos o de más de 80 caracteres y conserva el anterior", async () => {
      const packageId = await newPackage();
      const sala = await createGroup(packageId, "Sala");

      for (const name of ["   ", "x".repeat(81)]) {
        await expect(renameGroup(packageId, sala, name)).rejects.toMatchObject({
          message: expect.stringContaining("package.invalid_group_name"),
        });
      }

      expect((await groupRow(sala))?.name).toBe("Sala");
      expect((await snapshot(packageId)).structureVersion).toBe(1);
    });

    it("rechaza paquete ajeno, grupo inexistente, grupo de otro paquete y versión obsoleta", async () => {
      const packageId = await newPackage();
      const otherPackage = await newPackage();
      const sala = await createGroup(packageId, "Sala");
      const ajeno = await createGroup(otherPackage, "Ajeno");

      await expect(renameGroup(packageId, sala, "X", USER_B)).rejects.toMatchObject({
        message: expect.stringContaining("package.not_found"),
      });
      await expect(renameGroup(packageId, randomUUID(), "X")).rejects.toMatchObject({
        message: expect.stringContaining("package.group_not_found"),
      });
      await expect(renameGroup(packageId, ajeno, "X")).rejects.toMatchObject({
        message: expect.stringContaining("package.group_not_found"),
      });
      await expect(renameGroup(packageId, sala, "X", USER_A, 99)).rejects.toMatchObject({
        message: expect.stringContaining("package.version_conflict"),
      });

      expect((await groupRow(sala))?.name).toBe("Sala");
      expect((await groupRow(ajeno))?.name).toBe("Ajeno");
    });
  });

  describe("delete_package_group", () => {
    it("al eliminar un grupo raíz, hojas y subgrupos pasan al nivel principal y suben un nivel", async () => {
      const packageId = await newPackage();
      const sala = await createGroup(packageId, "Sala", null, 2);
      const mesa = await createGroup(packageId, "Mesa", sala, 1);
      const centro = await createGroup(packageId, "Centro", mesa, 1);
      const before = await snapshot(packageId);

      const deleted = await deleteGroup(packageId, sala, USER_A, before.version);

      expect(deleted).toEqual({
        groupId: sala,
        parentGroupId: null,
        promotedGroups: 1,
        promotedItems: 2,
        structureVersion: 2,
      });
      expect(await groupRow(sala)).toBeNull();
      expect(await groupRow(mesa)).toEqual({ depth: 1, name: "Mesa", parent_group_id: null });
      expect(await groupRow(centro)).toEqual({ depth: 2, name: "Centro", parent_group_id: mesa });
      expect(await itemsIn(packageId, null)).toBe(2);
      expect(await itemsIn(packageId, mesa)).toBe(1);
      expect(await itemsIn(packageId, centro)).toBe(1);

      const after = await snapshot(packageId);
      expect(after.items).toHaveLength(before.items.length);
      expect(after.version).toBe(before.version);
      expect(after.events).toBe(before.events);
    });

    it("al eliminar un subgrupo, su contenido pasa al grupo padre sin perderse", async () => {
      const packageId = await newPackage();
      const sala = await createGroup(packageId, "Sala", null, 1);
      const mesa = await createGroup(packageId, "Mesa", sala, 2);
      const centro = await createGroup(packageId, "Centro", mesa, 1);

      const deleted = await deleteGroup(packageId, mesa);

      expect(deleted).toMatchObject({ parentGroupId: sala, promotedGroups: 1, promotedItems: 2 });
      expect(await groupRow(centro)).toEqual({ depth: 2, name: "Centro", parent_group_id: sala });
      expect(await itemsIn(packageId, sala)).toBe(3);
      expect(await itemsIn(packageId, centro)).toBe(1);
      expect((await snapshot(packageId)).items).toHaveLength(4);
    });

    it("eliminar un grupo vacío solo quita el grupo", async () => {
      const packageId = await newPackage();
      const sala = await createGroup(packageId, "Sala");

      expect(await deleteGroup(packageId, sala)).toMatchObject({ promotedGroups: 0, promotedItems: 0 });
      expect((await snapshot(packageId)).groups).toEqual([]);
    });

    it("si la promoción falla, no queda ningún cambio parcial", async () => {
      const packageId = await newPackage();
      const sala = await createGroup(packageId, "Sala", null, 2);
      await createGroup(packageId, "Mesa", sala, 1);
      const before = await snapshot(packageId);

      // Simula un fallo después de mover las hojas: el movimiento de subgrupos explota.
      await db.exec(`
        CREATE FUNCTION public.test_fail_group_move() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.package_id = '${packageId}' THEN
            RAISE EXCEPTION 'test.forced_failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER trg_test_fail_group_move AFTER UPDATE ON public.package_groups
          FOR EACH ROW EXECUTE FUNCTION public.test_fail_group_move();
      `);

      try {
        await expect(deleteGroup(packageId, sala)).rejects.toMatchObject({
          message: expect.stringContaining("test.forced_failure"),
        });
      } finally {
        await db.exec(`
          DROP TRIGGER trg_test_fail_group_move ON public.package_groups;
          DROP FUNCTION public.test_fail_group_move();
        `);
      }

      expect(await snapshot(packageId)).toEqual(before);
    });

    it("rechaza paquete ajeno, grupo inexistente o de otro paquete y versión obsoleta sin cambios", async () => {
      const packageId = await newPackage();
      const otherPackage = await newPackage();
      const sala = await createGroup(packageId, "Sala", null, 1);
      const ajeno = await createGroup(otherPackage, "Ajeno");
      const before = await snapshot(packageId);
      const version = await currentVersion(packageId);

      await expect(deleteGroup(packageId, sala, USER_B)).rejects.toMatchObject({
        message: expect.stringContaining("package.not_found"),
      });
      await expect(deleteGroup(packageId, randomUUID())).rejects.toMatchObject({
        message: expect.stringContaining("package.group_not_found"),
      });
      await expect(deleteGroup(packageId, ajeno)).rejects.toMatchObject({
        message: expect.stringContaining("package.group_not_found"),
      });
      await expect(deleteGroup(packageId, sala, USER_A, version + 1)).rejects.toMatchObject({
        message: expect.stringContaining("package.version_conflict"),
      });

      expect(await snapshot(packageId)).toEqual(before);
      expect(await groupRow(ajeno)).not.toBeNull();
    });

    it("fuera del RPC, la posición de un grupo sigue siendo inmutable", async () => {
      const packageId = await newPackage();
      const sala = await createGroup(packageId, "Sala");
      const mesa = await createGroup(packageId, "Mesa", sala);
      const otro = await createGroup(packageId, "Otro");
      await deleteGroup(packageId, otro);

      await expect(
        db.query(`UPDATE public.package_groups SET parent_group_id = NULL WHERE id = $1`, [mesa]),
      ).rejects.toMatchObject({ message: expect.stringContaining("package.group_immutable") });
      await expect(
        db.query(`UPDATE public.package_groups SET depth = 1 WHERE id = $1`, [mesa]),
      ).resolves.toBeDefined();
      expect((await groupRow(mesa))?.depth).toBe(2);
    });

    it("clone_package copia la jerarquía resultante con ids nuevos e independientes", async () => {
      const packageId = await newPackage();
      const sala = await createGroup(packageId, "Sala", null, 1);
      const mesa = await createGroup(packageId, "Mesa", sala, 1);
      await createGroup(packageId, "Centro", mesa, 1);
      await deleteGroup(packageId, sala);

      const cloned = await db.query<{ result: { id: string; groupCount: number; itemCount: number } }>(
        `SELECT public.clone_package($1, $2) AS result`,
        [packageId, USER_A],
      );
      const clone = cloned.rows[0].result;
      expect(clone).toMatchObject({ groupCount: 2, itemCount: 3 });

      const groups = await db.query<{ id: string; name: string; depth: number }>(
        `SELECT id, name, depth FROM public.package_groups WHERE package_id = $1 ORDER BY depth`,
        [clone.id],
      );
      expect(groups.rows.map((g) => [g.name, g.depth])).toEqual([
        ["Mesa", 1],
        ["Centro", 2],
      ]);
      expect(groups.rows.map((g) => g.id)).not.toContain(mesa);

      const cloneMesa = groups.rows[0].id;
      await deleteGroup(clone.id, cloneMesa);
      expect(await groupRow(mesa)).toEqual({ depth: 1, name: "Mesa", parent_group_id: null });
    });
  });

  it("anon y authenticated no pueden ejecutar los RPC nuevos", async () => {
    const packageId = await newPackage();
    const sala = await createGroup(packageId, "Sala");

    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        asRole(role, USER_A, () =>
          db.query(`SELECT public.rename_package_group($1, $2, $3, 'X', NULL)`, [packageId, USER_A, sala]),
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole(role, USER_A, () =>
          db.query(`SELECT public.delete_package_group($1, $2, $3, NULL)`, [packageId, USER_A, sala]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }

    expect(await groupRow(sala)).not.toBeNull();
  });
});
