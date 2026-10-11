// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PackageController } from "../../interfaces/packages/package-controller";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import type { PackageModuleAddedEvent } from "../events/domain/event-contracts";
import type { AuthorizePackageAccessUseCase } from "./application/authorize-package-access.use-case";
import type { CatalogModuleReader } from "./application/ports/catalog-module-reader.port";
import type { PackageChangeConsumer } from "./application/ports/package-change-consumer.port";
import type {
  CreatedGroupRecord,
  PackageGroupReader,
  PackageGroupRepository,
  PackageStructure,
} from "./application/ports/package-group-repository.port";
import type { PackageReader } from "./application/ports/package-reader.port";
import { AddModuleToGroupUseCase } from "./application/use-cases/add-module-to-group.use-case";
import { CreatePackageGroupUseCase } from "./application/use-cases/create-package-group.use-case";
import type { AddModuleToPackageUseCase } from "./application/use-cases/add-module-to-package.use-case";
import type { CreatePackageUseCase } from "./application/use-cases/create-package.use-case";
import type { RemoveModuleFromPackageUseCase } from "./application/use-cases/remove-module-from-package.use-case";
import { ModuloCompuesto } from "./domain/composite-module";
import { PaqueteDecoracionBuilderImpl } from "./domain/decoration-package-builder-impl";
import { crearZonaBienvenida } from "./domain/welcome-zone";

/**
 * Criterios de aceptación de DECOR-25 (Composite) sobre PostgreSQL embebido
 * con todas las migraciones: los casos de uso reales validan en el dominio y
 * los RPC confirman todo o nada.
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

let db: PGlite;

const rpcError = (cause: unknown): DomainError => {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = /^(package|event)\.[a-z_]+$/.test(message) ? message : "package.persistence_error";
  return new DomainError(code, message, { cause });
};

/** Puertos de lectura y escritura sobre PGlite, equivalentes a los adaptadores Supabase. */
const packageReader: PackageReader = {
  async getItemModuleId() {
    return ok(null);
  },
  async getPackage(packageId, userId) {
    const pkg = await db.query<{ id: string; user_id: string; space_type: "casa"; capacity_m2: string; version: number }>(
      `SELECT id, user_id, space_type, capacity_m2, version FROM public.packages WHERE id = $1 AND user_id = $2`,
      [packageId, userId],
    );
    if (pkg.rows.length === 0) return ok(null);

    const items = await db.query<{ id: string; module_id: string; area_m2: string }>(
      `SELECT i.id, i.module_id, c.area_m2 FROM public.package_items AS i
       JOIN public.catalog_modules AS c ON c.id = i.module_id WHERE i.package_id = $1`,
      [packageId],
    );
    const row = pkg.rows[0];
    return ok({
      capacityM2: Number(row.capacity_m2),
      id: row.id,
      items: items.rows.map((item) => ({ areaM2: Number(item.area_m2), itemId: item.id, moduleId: item.module_id })),
      spaceType: row.space_type,
      userId: row.user_id,
      version: row.version,
    });
  },
};

const catalogReader: CatalogModuleReader = {
  async getModuleById(moduleId) {
    const result = await db.query<{ id: string; name: string; area_m2: string; price_cop: number }>(
      `SELECT id, name, area_m2, price_cop FROM public.catalog_modules WHERE id = $1 AND status = 'active'`,
      [moduleId],
    );
    const row = result.rows[0];
    return ok(row ? { areaM2: Number(row.area_m2), id: row.id, name: row.name, priceCop: row.price_cop } : null);
  },
};

const groupStore: PackageGroupReader & PackageGroupRepository = {
  async getStructure(packageId): Promise<Result<PackageStructure, DomainError>> {
    const groups = await db.query<{ id: string; name: string; parent_group_id: string | null }>(
      `SELECT id, name, parent_group_id FROM public.package_groups WHERE package_id = $1`,
      [packageId],
    );
    const items = await db.query<{ id: string; group_id: string | null }>(
      `SELECT id, group_id FROM public.package_items WHERE package_id = $1`,
      [packageId],
    );
    return ok({
      groups: groups.rows.map((g) => ({ groupId: g.id, name: g.name, parentGroupId: g.parent_group_id })),
      itemGroupIds: Object.fromEntries(items.rows.map((i) => [i.id, i.group_id])),
    });
  },
  async createGroup(command): Promise<Result<CreatedGroupRecord, DomainError>> {
    try {
      const result = await db.query<{ result: CreatedGroupRecord }>(
        `SELECT public.create_package_group($1, $2, $3, $4, $5, $6::jsonb, $7) AS result`,
        [
          command.packageId,
          command.userId,
          command.groupId,
          command.name,
          command.parentGroupId,
          JSON.stringify(command.events),
          command.expectedVersion,
        ],
      );
      return ok(result.rows[0].result);
    } catch (cause) {
      return err(rpcError(cause));
    }
  },
  async addItemToGroup(event: PackageModuleAddedEvent, groupId, expectedVersion) {
    try {
      const result = await db.query<{ version: number }>(
        `SELECT public.add_package_item_to_group($1::jsonb, $2, $3) AS version`,
        [JSON.stringify(event), groupId, expectedVersion],
      );
      return ok(result.rows[0].version);
    } catch (cause) {
      return err(rpcError(cause));
    }
  },
};

const clock = { now: () => new Date("2026-10-12T10:00:00.000Z") };
const ids = { generate: () => randomUUID() };

function useCases(consumer?: PackageChangeConsumer) {
  return {
    addToGroup: new AddModuleToGroupUseCase(packageReader, groupStore, catalogReader, groupStore, clock, ids, consumer),
    createGroup: new CreatePackageGroupUseCase(packageReader, groupStore, catalogReader, groupStore, clock, ids, consumer),
  };
}

async function newPackage(userId = USER_A, capacityM2 = 30): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version) VALUES ($1, $2, 'casa', $3, 1)`,
    [id, userId, capacityM2],
  );
  return id;
}

async function rows(packageId: string) {
  const one = async (sql: string) => Number((await db.query<{ n: string }>(sql, [packageId])).rows[0].n);
  return {
    events: await one(`SELECT count(*) AS n FROM private.domain_events WHERE package_id = $1`),
    groups: await one(`SELECT count(*) AS n FROM public.package_groups WHERE package_id = $1`),
    items: await one(`SELECT count(*) AS n FROM public.package_items WHERE package_id = $1`),
    version: await one(`SELECT version AS n FROM public.packages WHERE id = $1`),
  };
}

describe("DECOR-25 Criterios de aceptación: Composite para grupos decorativos", () => {
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
      ('${MODULE_ARCO}', 'arco-acc', 1, 'Arco floral', 200000, 2, 2, 2, 1,
       'https://example.com/a.glb', 'https://example.com/a.usdz', null, 'active'),
      ('${MODULE_MESA}', 'mesa-acc', 1, 'Mesa redonda', 250000, 4, 2, 1, 2,
       'https://example.com/m.glb', 'https://example.com/m.usdz', null, 'active');
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  describe("1. Contrato común y suma recursiva", () => {
    it("Zona de bienvenida = arco + mesa; hoja y grupo suman igual y el Builder usa el contrato", () => {
      const zona = crearZonaBienvenida("zona");
      if (!zona.ok) throw zona.error;

      expect(zona.value.calcularPrecio()).toBe(450000);
      expect(zona.value.calcularAreaM2()).toBe(6);

      const paquete = new PaqueteDecoracionBuilderImpl("casa", 30).agregarZonaBienvenida().agregarMesa().construir();
      expect(paquete.presupuestoTotal).toBe(700000);
      expect(paquete.espacioUsadoM2).toBe(10);
    });

    it("persiste la Zona de bienvenida con sus dos hojas y un package.module.added por hoja", async () => {
      const consumer: PackageChangeConsumer = { consume: vi.fn().mockResolvedValue(ok(undefined)) };
      const packageId = await newPackage();

      const result = await useCases(consumer).createGroup.execute({
        moduleIds: [MODULE_ARCO, MODULE_MESA],
        name: "Zona de bienvenida",
        packageId,
        userId: USER_A,
      });

      expect(result.ok).toBe(true);
      expect(await rows(packageId)).toEqual({ events: 2, groups: 1, items: 2, version: 3 });
      expect(consumer.consume).toHaveBeenCalledTimes(2);
    });
  });

  describe("2. Tres niveles admitidos; cuarto nivel y ciclos rechazados", () => {
    it("crea tres niveles y rechaza el cuarto en el dominio sin escribir nada", async () => {
      const packageId = await newPackage();
      const { createGroup } = useCases();

      let parentGroupId: string | null = null;
      for (const name of ["Nivel 1", "Nivel 2", "Nivel 3"]) {
        const created = await createGroup.execute({ name, packageId, parentGroupId, userId: USER_A });
        if (!created.ok) throw created.error;
        parentGroupId = created.value.groupId;
      }

      const before = await rows(packageId);
      const fourth = await createGroup.execute({ name: "Nivel 4", packageId, parentGroupId, userId: USER_A });

      expect(fourth.ok).toBe(false);
      if (!fourth.ok) expect(fourth.error.code).toBe("package.group_depth_exceeded");
      expect(await rows(packageId)).toEqual(before);
    });

    it("un ciclo se rechaza en el dominio y la base no permite re-asignar el padre", async () => {
      const a = ModuloCompuesto.crear("a", "A");
      const b = ModuloCompuesto.crear("b", "B");
      if (!a.ok || !b.ok) throw new Error("fixture");
      expect(a.value.agregar(b.value).ok).toBe(true);

      const cycle = b.value.agregar(a.value);
      expect(cycle.ok).toBe(false);
      if (!cycle.ok) expect(cycle.error.code).toBe("package.group_cycle");

      const packageId = await newPackage();
      const parent = await useCases().createGroup.execute({ name: "Padre", packageId, userId: USER_A });
      if (!parent.ok) throw parent.error;
      const child = await useCases().createGroup.execute({
        name: "Hijo",
        packageId,
        parentGroupId: parent.value.groupId,
        userId: USER_A,
      });
      if (!child.ok) throw child.error;

      await expect(
        db.query(`UPDATE public.package_groups SET parent_group_id = $1 WHERE id = $2`, [
          child.value.groupId,
          parent.value.groupId,
        ]),
      ).rejects.toMatchObject({ message: expect.stringContaining("package.group_immutable") });
    });
  });

  describe("3. Sin persistencia parcial", () => {
    it("si falla un hijo en la base se revierte el grupo completo, las hojas y los eventos", async () => {
      const packageId = await newPackage();
      const before = await rows(packageId);

      // La segunda hoja (mesa) falla al insertarse: simula un fallo de hijo dentro del RPC.
      await db.exec(`
        CREATE FUNCTION fail_second_child() RETURNS trigger AS $$
        BEGIN
          IF NEW.module_id = '${MODULE_MESA}'::uuid THEN
            RAISE EXCEPTION 'simulated_child_failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER trg_fail_second_child BEFORE INSERT ON public.package_items
          FOR EACH ROW EXECUTE FUNCTION fail_second_child();
      `);

      try {
        const result = await useCases().createGroup.execute({
          moduleIds: [MODULE_ARCO, MODULE_MESA],
          name: "Zona de bienvenida",
          packageId,
          userId: USER_A,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.message).toContain("simulated_child_failure");
        expect(await rows(packageId)).toEqual(before);
      } finally {
        await db.exec(`
          DROP TRIGGER trg_fail_second_child ON public.package_items;
          DROP FUNCTION fail_second_child();
        `);
      }
    });

    it("un grupo sin hojas no emite eventos ni recalcula", async () => {
      const consumer: PackageChangeConsumer = { consume: vi.fn().mockResolvedValue(ok(undefined)) };
      const packageId = await newPackage();

      const result = await useCases(consumer).createGroup.execute({ name: "Vacío", packageId, userId: USER_A });

      expect(result.ok).toBe(true);
      expect(await rows(packageId)).toEqual({ events: 0, groups: 1, items: 0, version: 1 });
      expect(consumer.consume).not.toHaveBeenCalled();
    });

    it("agregar una hoja a un grupo emite add; quitarla del grupo usa el remove existente", async () => {
      const packageId = await newPackage();
      const zona = await useCases().createGroup.execute({ name: "Zona", packageId, userId: USER_A });
      if (!zona.ok) throw zona.error;

      const added = await useCases().addToGroup.execute({
        groupId: zona.value.groupId,
        moduleId: MODULE_MESA,
        packageId,
        userId: USER_A,
      });
      if (!added.ok) throw added.error;

      const removed = await db.query<{ version: number }>(`SELECT public.commit_package_change($1::jsonb, NULL) AS version`, [
        JSON.stringify({
          eventId: randomUUID(),
          occurredAt: "2026-10-12T10:00:00.000Z",
          packageId,
          payload: { itemId: added.value.itemId, moduleId: MODULE_MESA },
          schemaVersion: 1,
          type: "package.module.removed",
          userId: USER_A,
        }),
      ]);

      expect(removed.rows[0].version).toBe(3);
      const types = await db.query<{ event_type: string }>(
        `SELECT event_type FROM private.domain_events WHERE package_id = $1 ORDER BY id`,
        [packageId],
      );
      expect(types.rows.map((r) => r.event_type)).toEqual(["package.module.added", "package.module.removed"]);
      expect(await rows(packageId)).toMatchObject({ groups: 1, items: 0 });
    });

    it("la capacidad cuenta las hojas dentro de grupos y rechaza sin escribir", async () => {
      const packageId = await newPackage(USER_A, 5);
      const before = await rows(packageId);

      const result = await useCases().createGroup.execute({
        moduleIds: [MODULE_ARCO, MODULE_MESA],
        name: "Zona de bienvenida",
        packageId,
        userId: USER_A,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.capacity_exceeded");
      expect(await rows(packageId)).toEqual(before);
    });
  });

  describe("4. Un usuario ajeno no crea grupos en otro paquete", () => {
    it("el caso de uso no encuentra el paquete de A para B y no escribe nada", async () => {
      const packageId = await newPackage(USER_A);
      const before = await rows(packageId);

      const result = await useCases().createGroup.execute({
        moduleIds: [MODULE_ARCO],
        name: "Intruso",
        packageId,
        userId: USER_B,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.not_found");
      expect(await rows(packageId)).toEqual(before);
    });

    it("el RPC también lo rechaza aunque se salte el dominio", async () => {
      const packageId = await newPackage(USER_A);

      const result = await groupStore.createGroup({
        events: [],
        expectedVersion: 1,
        groupId: randomUUID(),
        name: "Intruso",
        packageId,
        parentGroupId: null,
        userId: USER_B,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.not_found");
    });

    it("el Route Handler responde 404 al ajeno y 401 al anónimo sin tocar el caso de uso", async () => {
      const createGroup = { execute: vi.fn() };
      const controllerFor = (error: DomainError) =>
        new PackageController(
          { currentUser: vi.fn().mockResolvedValue(null) },
          { execute: vi.fn().mockResolvedValue(err(error)) } as unknown as AuthorizePackageAccessUseCase,
          {} as CreatePackageUseCase,
          {} as AddModuleToPackageUseCase,
          {} as RemoveModuleFromPackageUseCase,
          { createPackageGroupUseCase: createGroup as unknown as CreatePackageGroupUseCase },
        );
      const request = () =>
        new Request("http://localhost/api/packages/pkg/groups", {
          body: JSON.stringify({ name: "Zona de bienvenida" }),
          method: "POST",
        });

      const foreign = await controllerFor(new DomainError("package.not_found", "No encontramos este paquete.")).handleCreateGroup(
        request(),
        "pkg",
      );
      const anonymous = await controllerFor(new DomainError("auth.unauthenticated", "Inicia sesión.")).handleCreateGroup(
        request(),
        "pkg",
      );

      expect(foreign.status).toBe(404);
      expect(anonymous.status).toBe(401);
      expect(createGroup.execute).not.toHaveBeenCalled();
    });

    it("RLS: B no ve los grupos de A y ningún rol cliente puede ejecutar el RPC", async () => {
      const packageId = await newPackage(USER_A);
      await useCases().createGroup.execute({ name: "Zona", packageId, userId: USER_A });

      await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${USER_B}', false);`);
      try {
        const visible = await db.query(`SELECT id FROM public.package_groups WHERE package_id = $1`, [packageId]);
        expect(visible.rows).toHaveLength(0);

        await expect(
          db.query(`SELECT public.create_package_group($1, $2, $3, 'X', NULL, '[]'::jsonb, NULL)`, [
            packageId,
            USER_B,
            randomUUID(),
          ]),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
      }
    });
  });

  describe("5. Composite visible: API y UI consumen el endpoint de grupos", () => {
    it("el cliente de la interfaz crea la Zona de bienvenida por POST /groups", async () => {
      const { createHttpPackageGroupsClient } = await import("../../app/(protected)/packages/_lib/package-groups-client");
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { depth: 1, groupId: "g", itemIds: ["a", "m"], name: "Zona de bienvenida", packageVersion: 3, parentGroupId: null },
          { status: 201 },
        ),
      );

      const result = await createHttpPackageGroupsClient(fetcher).createGroup("pkg-1", {
        moduleIds: [MODULE_ARCO, MODULE_MESA],
        name: "Zona de bienvenida",
      });

      expect(result.ok).toBe(true);
      expect(fetcher.mock.calls[0][0]).toBe("/api/packages/pkg-1/groups");
    });
  });
});
