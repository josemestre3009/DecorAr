// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DECOR-46: ejecuta todas las migraciones en PostgreSQL embebido y prueba la
 * defensa en base de datos de la escena: posiciones por unidad, aislamiento
 * por propietario, límites, conflicto de versión, cascada y que guardar la
 * escena no afecta a `packages.version` ni a `budgets`.
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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

const MIGRATION = "20261018000000_create_package_scene_transforms.sql";

let db: PGlite;

async function newPackage(userId = USER_A, version = 1): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version)
     VALUES ($1, $2, 'salonSocial', 50, $3)`,
    [id, userId, version],
  );
  return id;
}

async function newItem(packageId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.package_items (id, package_id, module_id) VALUES ($1, $2, $3)`,
    [id, packageId, MODULE_ID],
  );
  return id;
}

type Transform = { itemId: string; x: number; y: number; z: number; rotationDeg: number };

async function saveScene(params: {
  packageId: string;
  userId?: string;
  transforms: Transform[];
  expectedVersion?: number | null;
}): Promise<number> {
  const result = await db.query<{ version: number }>(
    `SELECT public.save_package_scene($1, $2, $3::jsonb, $4) AS version`,
    [
      params.packageId,
      params.userId ?? USER_A,
      JSON.stringify(params.transforms),
      params.expectedVersion ?? null,
    ],
  );
  return result.rows[0].version;
}

async function packageVersion(packageId: string): Promise<number> {
  const result = await db.query<{ version: number }>(
    `SELECT version FROM public.packages WHERE id = $1`,
    [packageId],
  );
  return result.rows[0].version;
}

async function asRole<T extends Record<string, unknown>>(
  role: "anon" | "authenticated",
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[] }> {
  await db.exec(`SET ROLE ${role};`);
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("RESET ROLE;");
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}

describe("DECOR-46 migración: posición y rotación por unidad", () => {
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
      ('${MODULE_ID}', 'mesa-test', 1, 'Mesa redonda', 250000, 4, 2, 1, 2,
       'https://example.com/m.glb', 'https://example.com/m.usdz', null, 'active');
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("la nueva función es SECURITY INVOKER con search_path vacío", async () => {
    const sql = await readFile(resolve("supabase/migrations", MIGRATION), "utf8");

    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain("SET search_path = ''");
    expect(sql).not.toContain("SECURITY DEFINER");
  });

  it("guarda posiciones distintas para unidades repetidas del mismo módulo", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);
    const itemB = await newItem(packageId);

    const version = await saveScene({
      packageId,
      transforms: [
        { itemId: itemA, rotationDeg: 10, x: 1, y: 0, z: 1 },
        { itemId: itemB, rotationDeg: 20, x: -1, y: 0, z: -1 },
      ],
    });

    expect(version).toBe(1);

    const rows = await db.query<{ item_id: string; x: number; z: number }>(
      `SELECT item_id, x, z FROM public.package_item_transforms WHERE package_id = $1 ORDER BY item_id`,
      [packageId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.find((r) => r.item_id === itemA)).toMatchObject({ x: 1, z: 1 });
    expect(rows.rows.find((r) => r.item_id === itemB)).toMatchObject({ x: -1, z: -1 });
  });

  it("guardar y volver a leer recupera exactamente la escena", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);

    await saveScene({ packageId, transforms: [{ itemId: itemA, rotationDeg: 90, x: 2, y: 0, z: 3 }] });

    const read = await db.query<{ x: number; y: number; z: number; rotation_deg: number }>(
      `SELECT x, y, z, rotation_deg FROM public.package_item_transforms WHERE package_id = $1`,
      [packageId],
    );
    expect(read.rows[0]).toEqual({ rotation_deg: 90, x: 2, y: 0, z: 3 });
  });

  it("reemplazar la escena quita las posiciones que ya no se envían", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);
    const itemB = await newItem(packageId);

    await saveScene({
      packageId,
      transforms: [
        { itemId: itemA, rotationDeg: 0, x: 0, y: 0, z: 0 },
        { itemId: itemB, rotationDeg: 0, x: 1, y: 0, z: 1 },
      ],
    });
    await saveScene({ expectedVersion: 1, packageId, transforms: [{ itemId: itemA, rotationDeg: 0, x: 5, y: 0, z: 5 }] });

    const rows = await db.query(`SELECT item_id FROM public.package_item_transforms WHERE package_id = $1`, [packageId]);
    expect(rows.rows).toEqual([{ item_id: itemA }]);
  });

  it("rechaza guardar una escena con versión de escena obsoleta", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);
    await saveScene({ packageId, transforms: [{ itemId: itemA, rotationDeg: 0, x: 0, y: 0, z: 0 }] });

    await expect(
      saveScene({ expectedVersion: 0, packageId, transforms: [{ itemId: itemA, rotationDeg: 0, x: 1, y: 0, z: 1 }] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("scene.version_conflict") });

    const rows = await db.query<{ x: number }>(
      `SELECT x FROM public.package_item_transforms WHERE package_id = $1 AND item_id = $2`,
      [packageId, itemA],
    );
    expect(rows.rows[0].x).toBe(0);
  });

  it("rechaza una unidad que pertenece a otro paquete, sin escribir nada", async () => {
    const packageId = await newPackage();
    const otherPackageId = await newPackage();
    const foreignItem = await newItem(otherPackageId);

    await expect(
      saveScene({ packageId, transforms: [{ itemId: foreignItem, rotationDeg: 0, x: 0, y: 0, z: 0 }] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("scene.item_not_found") });

    const rows = await db.query(`SELECT item_id FROM public.package_item_transforms WHERE package_id = $1`, [packageId]);
    expect(rows.rows).toHaveLength(0);
  });

  it("rechaza guardar sobre un paquete ajeno", async () => {
    const packageId = await newPackage(USER_A);
    const itemA = await newItem(packageId);

    await expect(
      saveScene({ packageId, transforms: [{ itemId: itemA, rotationDeg: 0, x: 0, y: 0, z: 0 }], userId: USER_B }),
    ).rejects.toMatchObject({ message: expect.stringContaining("package.not_found") });
  });

  it("CHECK rechaza x fuera de [-50, 50]", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);

    await expect(
      saveScene({ packageId, transforms: [{ itemId: itemA, rotationDeg: 0, x: 51, y: 0, z: 0 }] }),
    ).rejects.toBeTruthy();
  });

  it("CHECK rechaza y fuera de [-1, 5]", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);

    await expect(
      saveScene({ packageId, transforms: [{ itemId: itemA, rotationDeg: 0, x: 0, y: 6, z: 0 }] }),
    ).rejects.toBeTruthy();
  });

  it("CHECK rechaza rotación fuera de [0, 360)", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);

    await expect(
      saveScene({ packageId, transforms: [{ itemId: itemA, rotationDeg: 360, x: 0, y: 0, z: 0 }] }),
    ).rejects.toBeTruthy();
  });

  it("borrar una unidad borra su posición guardada (cascada), sin afectar el resto", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);
    const itemB = await newItem(packageId);
    await saveScene({
      packageId,
      transforms: [
        { itemId: itemA, rotationDeg: 0, x: 1, y: 0, z: 1 },
        { itemId: itemB, rotationDeg: 0, x: 2, y: 0, z: 2 },
      ],
    });

    await db.query(`DELETE FROM public.package_items WHERE id = $1`, [itemA]);

    const rows = await db.query(`SELECT item_id FROM public.package_item_transforms WHERE package_id = $1`, [packageId]);
    expect(rows.rows).toEqual([{ item_id: itemB }]);
  });

  it("guardar la escena no cambia packages.version ni crea presupuesto ni eventos", async () => {
    const packageId = await newPackage();
    const itemA = await newItem(packageId);
    const versionBefore = await packageVersion(packageId);

    await saveScene({ packageId, transforms: [{ itemId: itemA, rotationDeg: 0, x: 1, y: 0, z: 1 }] });

    expect(await packageVersion(packageId)).toBe(versionBefore);

    const outboxCount = await db.query<{ count: string }>(
      `SELECT count(*) AS count FROM private.domain_events WHERE package_id = $1`,
      [packageId],
    );
    expect(Number(outboxCount.rows[0].count)).toBe(0);

    const budgetCount = await db.query<{ count: string }>(
      `SELECT count(*) AS count FROM public.budgets WHERE package_id = $1`,
      [packageId],
    );
    expect(Number(budgetCount.rows[0].count)).toBe(0);
  });

  it("un usuario no puede leer la escena de otro (RLS)", async () => {
    const packageId = await newPackage(USER_A);
    const itemA = await newItem(packageId);
    await saveScene({ packageId, transforms: [{ itemId: itemA, rotationDeg: 0, x: 1, y: 0, z: 1 }] });

    const own = await asRole<{ package_id: string }>(
      "authenticated",
      USER_A,
      "SELECT package_id FROM public.package_scenes WHERE package_id = $1",
      [packageId],
    );
    expect(own.rows).toHaveLength(1);

    const foreign = await asRole<{ package_id: string }>(
      "authenticated",
      USER_B,
      "SELECT package_id FROM public.package_scenes WHERE package_id = $1",
      [packageId],
    );
    expect(foreign.rows).toHaveLength(0);

    const foreignTransforms = await asRole<{ item_id: string }>(
      "authenticated",
      USER_B,
      "SELECT item_id FROM public.package_item_transforms WHERE package_id = $1",
      [packageId],
    );
    expect(foreignTransforms.rows).toHaveLength(0);
  });

  it("anon no puede leer la escena ni ejecutar la RPC", async () => {
    const packageId = await newPackage();

    await expect(
      asRole("anon", null, "SELECT package_id FROM public.package_scenes WHERE package_id = $1", [packageId]),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      asRole("anon", null, "SELECT public.save_package_scene($1, $2, '[]'::jsonb, null)", [packageId, USER_A]),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
