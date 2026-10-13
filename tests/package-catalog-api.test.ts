// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogModule } from "../src/modules/catalog/domain/catalog-module";
import { CatalogController } from "../src/interfaces/catalog/catalog-controller";
import { PackageController } from "../src/interfaces/packages/package-controller";
import { DomainError } from "../src/shared/domain/domain-error";
import { err, ok, type Result } from "../src/shared/domain/result";
import type { SessionGateway } from "../src/shared/application/ports";
import type { SessionUser } from "../src/shared/domain/session";
import type { CatalogRepository } from "../src/modules/catalog/application/ports/catalog-repository.port";
import { GetActiveCatalogModulesUseCase } from "../src/modules/catalog/application/use-cases/get-active-catalog-modules.use-case";
import {
  AuthorizePackageAccessUseCase,
  type PackageOwnerReader,
} from "../src/modules/packages/application/authorize-package-access.use-case";
import type { CatalogModuleReader } from "../src/modules/packages/application/ports/catalog-module-reader.port";
import type { PackageChangeConsumer } from "../src/modules/packages/application/ports/package-change-consumer.port";
import type {
  CreatePackageGroupCommand,
  PackageGroupReader,
  PackageGroupRepository,
  PackageStructure,
} from "../src/modules/packages/application/ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../src/modules/packages/application/ports/package-reader.port";
import type { PackageRepository } from "../src/modules/packages/application/ports/package-repository.port";
import { AddModuleToGroupUseCase } from "../src/modules/packages/application/use-cases/add-module-to-group.use-case";
import { AddModuleToPackageUseCase } from "../src/modules/packages/application/use-cases/add-module-to-package.use-case";
import { ClonePackageUseCase } from "../src/modules/packages/application/use-cases/clone-package.use-case";
import { CreatePackageGroupUseCase } from "../src/modules/packages/application/use-cases/create-package-group.use-case";
import { CreatePackageUseCase } from "../src/modules/packages/application/use-cases/create-package.use-case";
import { RemoveModuleFromPackageUseCase } from "../src/modules/packages/application/use-cases/remove-module-from-package.use-case";
import type { PackageChangeOutbox } from "../src/modules/events/application/outbox";
import type { DrainOutboxUseCase } from "../src/modules/events/application/drain-outbox.use-case";
import type { TipoEspacio } from "../src/modules/packages/domain/space-type";

// --- Fixtures Canónicas de Usuarios ---
const USER_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const userA: SessionUser = { email: "user-a@decorar.test", id: USER_A };
const userB: SessionUser = { email: "user-b@decorar.test", id: USER_B };

// --- Fixtures Canónicas de Catálogo (DecorAR §4.1) ---
const MOD_PISTA = "aaaaaaaa-0001-4000-8000-000000000001";
const MOD_MESA = "aaaaaaaa-0002-4000-8000-000000000002";
const MOD_ARCO = "aaaaaaaa-0003-4000-8000-000000000003";

interface RpcCloneRow {
  clone_package: {
    id: string;
    spaceType?: TipoEspacio;
    space_type?: TipoEspacio;
    capacityM2?: number;
    capacity_m2?: number;
    style?: string | null;
    colors?: string[];
    notes?: string;
    version: number;
    itemCount?: number;
    item_count?: number;
  };
}

interface RpcCreateGroupRow {
  create_package_group: {
    groupId?: string;
    group_id?: string;
    depth: number;
    itemIds?: string[];
    item_ids?: string[];
    name?: string;
    packageVersion?: number;
    package_version?: number;
  };
}

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

describe("DECOR-26: Pruebas de integración de API, Persistencia y Patrones", () => {
  let db: PGlite;
  let resetSql: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);

    // 1. Aplicar todas las migraciones desde cero en orden alfabético
    const dir = resolve("supabase/migrations");
    const migrationFiles = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(dir, file), "utf8"));
    }

    // 2. Leer el script de reseteo server-side versionado
    resetSql = await readFile(resolve("supabase/reset-test-database.sql"), "utf8");

    // 3. Sembrar usuarios y catálogo canónico
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');

      INSERT INTO public.catalog_modules (
        id, asset_id, version, name, price_cop, area_m2, width_m, height_m, depth_m,
        glb_url, usdz_url, poster_url, status
      ) VALUES
        ('${MOD_PISTA}', 'pista-asset', 1, 'Pista de baile 4x4', 600000, 16.0, 4.0, 1.0, 4.0, 'https://example.com/pista.glb', 'https://example.com/pista.usdz', 'https://example.com/pista.webp', 'active'),
        ('${MOD_MESA}', 'mesa-asset', 1, 'Mesa redonda x10', 250000, 4.0, 2.0, 1.0, 2.0, 'https://example.com/mesa.glb', 'https://example.com/mesa.usdz', 'https://example.com/mesa.webp', 'active'),
        ('${MOD_ARCO}', 'arco-asset', 1, 'Arco floral de entrada', 200000, 2.0, 2.0, 2.0, 1.0, 'https://example.com/arco.glb', 'https://example.com/arco.usdz', 'https://example.com/arco.webp', 'active');
    `);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  // Aislamiento: ejecutar el script de reset server-side antes de cada test
  beforeEach(async () => {
    await db.exec(resetSql);
  });

  // --------------------------------------------------------------------------
  // Fábricas de Adaptadores conectadas a PostgreSQL real (PGlite)
  // --------------------------------------------------------------------------
  function createControllerContext(currentUser: SessionUser | null) {
    const sessionGateway: Pick<SessionGateway, "currentUser"> = {
      currentUser: async () => currentUser,
    };

    const packageOwnerReader: PackageOwnerReader = {
      async findOwnerId(packageId: string) {
        const res = await db.query<{ user_id: string }>(
          `SELECT user_id FROM public.packages WHERE id = $1`,
          [packageId],
        );
        return ok(res.rows[0]?.user_id ?? null);
      },
    };

    const packageRepository: PackageRepository = {
      async create(params) {
        try {
          const res = await db.query<{ create_package: { id: string } }>(
            `SELECT public.create_package($1, $2, $3, $4, $5, $6, $7, $8);`,
            [
              params.userId,
              params.name,
              params.spaceType,
              params.capacityM2,
              params.clientName,
              params.eventDate,
              params.venue,
              params.eventType,
            ],
          );
          const raw = res.rows[0].create_package;
          return ok({
            capacityM2: params.capacityM2,
            clientName: params.clientName,
            eventDate: params.eventDate,
            eventType: params.eventType,
            id: raw.id,
            name: params.name,
            spaceType: params.spaceType,
            spatial: {
              availableM2: params.capacityM2,
              requiredM2: 0,
              status: params.capacityM2 === null ? "pending" : "compatible",
            },
            venue: params.venue,
          });
        } catch {
          return err(new DomainError("package.persistence_error", "Error al crear paquete"));
        }
      },
      async updateMetadata() {
        return err(new DomainError("package.persistence_error", "updateMetadata no soportado en la shim PGlite"));
      },
      async clone(params) {
        try {
          const res = await db.query<RpcCloneRow>(
            `SELECT public.clone_package($1, $2);`,
            [params.sourcePackageId, params.userId],
          );
          const raw = res.rows[0].clone_package;
          return ok({
            capacityM2: Number(raw.capacityM2 ?? raw.capacity_m2),
            colors: raw.colors ?? [],
            id: raw.id,
            itemCount: Number(raw.itemCount ?? raw.item_count),
            notes: raw.notes ?? "",
            spaceType: (raw.spaceType ?? raw.space_type) as TipoEspacio,
            style: raw.style ?? null,
            version: Number(raw.version),
          });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes("package.not_found")) {
            return err(new DomainError("package.not_found", "No encontramos este paquete."));
          }
          return err(new DomainError("package.persistence_error", "Error al clonar"));
        }
      },
    };

    const packageReader: PackageReader = {
      async getPackage(packageId: string): Promise<Result<PackageDetail | null, DomainError>> {
        const pkgRes = await db.query<{
          capacity_m2: number;
          id: string;
          space_type: string;
          user_id: string;
          version: number;
        }>(`SELECT id, user_id, space_type, capacity_m2, version FROM public.packages WHERE id = $1`, [packageId]);

        if (pkgRes.rows.length === 0) {
          return ok(null);
        }

        const itemsRes = await db.query<{
          area_m2: number;
          id: string;
          module_id: string;
        }>(
          `SELECT pi.id, pi.module_id, cm.area_m2
           FROM public.package_items pi
           JOIN public.catalog_modules cm ON cm.id = pi.module_id
           WHERE pi.package_id = $1`,
          [packageId],
        );

        const row = pkgRes.rows[0];
        return ok({
          capacityM2: Number(row.capacity_m2),
          clientName: null,
          eventDate: null,
          eventType: null,
          id: row.id,
          items: itemsRes.rows.map((i) => ({ areaM2: Number(i.area_m2), itemId: i.id, moduleId: i.module_id })),
          name: "Evento",
          spaceType: row.space_type as TipoEspacio,
          userId: row.user_id,
          venue: null,
          version: Number(row.version),
        });
      },
      async getItemModuleId(packageId: string, itemId: string) {
        const res = await db.query<{ module_id: string }>(
          `SELECT module_id FROM public.package_items WHERE package_id = $1 AND id = $2`,
          [packageId, itemId],
        );
        return ok(res.rows[0]?.module_id ?? null);
      },
    };

    const catalogReader: CatalogModuleReader = {
      async getModuleById(moduleId: string) {
        const res = await db.query<{
          area_m2: number;
          name: string;
          price_cop: number;
          status: string;
        }>(`SELECT name, area_m2, price_cop, status FROM public.catalog_modules WHERE id = $1`, [moduleId]);

        const row = res.rows[0];
        if (!row || row.status !== "active") return ok(null);
        return ok({
          areaM2: Number(row.area_m2),
          id: moduleId,
          name: row.name,
          priceCop: Number(row.price_cop),
        });
      },
    };

    const outbox: PackageChangeOutbox = {
      async commit(event, expectedVersion, correlationId) {
        try {
          const res = await db.query<{ commit_package_change: number }>(
            `SELECT public.commit_package_change($1::jsonb, $2, $3);`,
            [JSON.stringify(event), expectedVersion ?? null, correlationId ?? null],
          );
          return ok(res.rows[0].commit_package_change);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes("event.duplicate")) {
            return err(new DomainError("event.duplicate", "Evento duplicado"));
          }
          if (msg.includes("package.version_conflict")) {
            return err(new DomainError("package.version_conflict", "Conflicto de versión"));
          }
          return err(new DomainError("package.persistence_error", "Error transaccional en outbox"));
        }
      },
    };

    const groupStore: PackageGroupRepository & PackageGroupReader = {
      async getStructure(packageId: string): Promise<Result<PackageStructure, DomainError>> {
        const groupsRes = await db.query<{ id: string; name: string; parent_group_id: string | null }>(
          `SELECT id, name, parent_group_id FROM public.package_groups WHERE package_id = $1`,
          [packageId],
        );
        const itemsRes = await db.query<{ group_id: string | null; id: string }>(
          `SELECT id, group_id FROM public.package_items WHERE package_id = $1`,
          [packageId],
        );
        return ok({
          groups: groupsRes.rows.map((g) => ({ groupId: g.id, name: g.name, parentGroupId: g.parent_group_id })),
          itemGroupIds: Object.fromEntries(itemsRes.rows.map((i) => [i.id, i.group_id])),
        });
      },
      async createGroup(command: CreatePackageGroupCommand) {
        try {
          const res = await db.query<RpcCreateGroupRow>(
            `SELECT public.create_package_group($1, $2, $3, $4, $5, $6::jsonb, $7, $8);`,
            [
              command.packageId,
              command.userId,
              command.groupId,
              command.name,
              command.parentGroupId ?? null,
              JSON.stringify(command.events),
              command.expectedVersion,
              command.correlationId ?? null,
            ],
          );
          const raw = res.rows[0].create_package_group;
          return ok({
            depth: Number(raw.depth),
            groupId: raw.groupId ?? raw.group_id ?? "",
            itemIds: raw.itemIds ?? raw.item_ids ?? [],
            name: command.name,
            packageVersion: Number(raw.packageVersion ?? raw.package_version),
          });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes("package.group_depth_exceeded")) {
            return err(new DomainError("package.group_depth_exceeded", "Profundidad máxima excedida"));
          }
          if (msg.includes("package.group_cycle")) {
            return err(new DomainError("package.group_cycle", "Ciclo detectado"));
          }
          return err(new DomainError("package.persistence_error", "Error al crear grupo"));
        }
      },
      async addItemToGroup(event, groupId, expectedVersion, correlationId) {
        try {
          const res = await db.query<{ add_package_item_to_group: number }>(
            `SELECT public.add_package_item_to_group($1::jsonb, $2, $3, $4);`,
            [JSON.stringify(event), groupId, expectedVersion, correlationId ?? null],
          );
          return ok(res.rows[0].add_package_item_to_group);
        } catch {
          return err(new DomainError("package.persistence_error", "Error al añadir ítem a grupo"));
        }
      },
    };

    const changeConsumer: PackageChangeConsumer = {
      consume: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const drainOutbox = {
      execute: vi.fn().mockResolvedValue(ok({ claimed: 0, drained: 0 })),
    } as unknown as Pick<DrainOutboxUseCase, "execute">;

    const clock = { now: () => new Date("2026-10-12T12:00:00.000Z") };
    const ids = { generate: () => randomUUID() };

    const authorizePackageAccess = new AuthorizePackageAccessUseCase(sessionGateway, packageOwnerReader);
    const createPackageUseCase = new CreatePackageUseCase(packageRepository);
    const addModuleToPackageUseCase = new AddModuleToPackageUseCase(packageReader, catalogReader, outbox, clock, ids, changeConsumer);
    const removeModuleFromPackageUseCase = new RemoveModuleFromPackageUseCase(packageReader, outbox, clock, ids, changeConsumer);
    const clonePackageUseCase = new ClonePackageUseCase(packageRepository);
    const createPackageGroupUseCase = new CreatePackageGroupUseCase(packageReader, groupStore, catalogReader, groupStore, clock, ids, changeConsumer);
    const addModuleToGroupUseCase = new AddModuleToGroupUseCase(packageReader, groupStore, catalogReader, groupStore, clock, ids, changeConsumer);

    const packageController = new PackageController(
      sessionGateway,
      authorizePackageAccess,
      createPackageUseCase,
      addModuleToPackageUseCase,
      removeModuleFromPackageUseCase,
      {
        addModuleToGroupUseCase,
        clonePackageUseCase,
        createPackageGroupUseCase,
        drainOutbox,
      },
    );

    const catalogRepo: CatalogRepository = {
      async getActiveModules() {
        const res = await db.query<{
          area_m2: number;
          asset_id: string;
          depth_m: number;
          glb_url: string;
          height_m: number;
          id: string;
          name: string;
          poster_url: string | null;
          price_cop: number;
          status: string;
          usdz_url: string;
          version: number;
          width_m: number;
        }>(`SELECT * FROM public.catalog_modules WHERE status = 'active' ORDER BY name ASC`);

        const modules: CatalogModule[] = [];
        for (const r of res.rows) {
          const mod = CatalogModule.create({
            areaM2: Number(r.area_m2),
            assetId: r.asset_id,
            depthM: Number(r.depth_m),
            glbUrl: r.glb_url,
            heightM: Number(r.height_m),
            id: r.id,
            name: r.name,
            posterUrl: r.poster_url,
            priceCop: Number(r.price_cop),
            status: r.status as "active" | "draft" | "retired",
            usdzUrl: r.usdz_url,
            version: Number(r.version),
            widthM: Number(r.width_m),
          });
          if (mod.ok) modules.push(mod.value);
        }
        return ok(modules);
      },
    };

    const catalogController = new CatalogController(new GetActiveCatalogModulesUseCase(catalogRepo));

    return { changeConsumer, drainOutbox, catalogController, packageController };
  }

  // --------------------------------------------------------------------------
  // 1. Catálogo de Módulos (GET /api/modules - DECOR-28)
  // --------------------------------------------------------------------------
  describe("1. Catálogo de módulos (GET /api/modules)", () => {
    it("responde 200 OK con los módulos activos y encabezados de caché correctos para cualquier usuario", async () => {
      const { catalogController } = createControllerContext(null); // Anónimo

      const response = await catalogController.handleGetModules();

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300");

      const body = (await response.json()) as { name: string }[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(3);
      expect(body.map((m) => m.name)).toEqual([
        "Arco floral de entrada",
        "Mesa redonda x10",
        "Pista de baile 4x4",
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Builder y Gestión de Paquetes (POST /packages, POST /items - DECOR-27)
  // --------------------------------------------------------------------------
  describe("2. Builder y gestión de paquetes (DECOR-27)", () => {
    it("Fixture 1: Salón social armado paso a paso (26 m², 1.300.000 COP en 4 ítems)", async () => {
      const { packageController } = createControllerContext(userA);

      // 1. Crear paquete de 50 m² para salonSocial
      const createReq = new Request("http://localhost/api/packages", {
        body: JSON.stringify({ capacityM2: 50, name: "Evento", spaceType: "salonSocial" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const createRes = await packageController.handleCreatePackage(createReq);
      expect(createRes.status).toBe(201);
      const pkg = (await createRes.json()) as { id: string; spaceType: string };
      expect(pkg.spaceType).toBe("salonSocial");

      // 2. Agregar 2× Mesa (4 m² c/u), 1× Arco (2 m²), 1× Pista (16 m²)
      const modulesToAdd = [MOD_MESA, MOD_MESA, MOD_ARCO, MOD_PISTA];
      for (const moduleId of modulesToAdd) {
        const addReq = new Request(`http://localhost/api/packages/${pkg.id}/items`, {
          body: JSON.stringify({ moduleId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const addRes = await packageController.handleAddItem(addReq, pkg.id);
        expect(addRes.status).toBe(201);
      }

      // 3. Verificar persistencia exacta en PostgreSQL: 4 ítems, versión 5, 4 eventos outbox
      const itemsDb = await db.query<{ count: string }>(
        `SELECT count(*) FROM public.package_items WHERE package_id = $1`,
        [pkg.id],
      );
      expect(Number(itemsDb.rows[0].count)).toBe(4);

      const pkgDb = await db.query<{ version: number }>(
        `SELECT version FROM public.packages WHERE id = $1`,
        [pkg.id],
      );
      expect(pkgDb.rows[0].version).toBe(5);

      const eventsDb = await db.query<{ count: string }>(
        `SELECT count(*) FROM private.domain_events WHERE package_id = $1`,
        [pkg.id],
      );
      expect(Number(eventsDb.rows[0].count)).toBe(4);
    });

    it("Fixture 2: Paquete básico del Director para aire libre (10 m², 700.000 COP en 3 ítems)", async () => {
      const { packageController } = createControllerContext(userA);

      const createRes = await packageController.handleCreatePackage(
        new Request("http://localhost/api/packages", {
          body: JSON.stringify({ capacityM2: 30, name: "Evento", spaceType: "aireLibre" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const pkg = (await createRes.json()) as { id: string };

      // Director: 1 Arco (2 m²) + 2 Mesas (4 m² + 4 m²) = 10 m²
      const directorModules = [MOD_ARCO, MOD_MESA, MOD_MESA];
      for (const moduleId of directorModules) {
        const res = await packageController.handleAddItem(
          new Request(`http://localhost/api/packages/${pkg.id}/items`, {
            body: JSON.stringify({ moduleId }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }),
          pkg.id,
        );
        expect(res.status).toBe(201);
      }

      const itemsDb = await db.query<{ count: string }>(
        `SELECT count(*) FROM public.package_items WHERE package_id = $1`,
        [pkg.id],
      );
      expect(Number(itemsDb.rows[0].count)).toBe(3);
    });

    it("Fixture 3: el exceso de área (32 m² en 30 m²) guarda con 201 y emite el evento (DECOR-44)", async () => {
      const { packageController } = createControllerContext(userA);

      const createRes = await packageController.handleCreatePackage(
        new Request("http://localhost/api/packages", {
          body: JSON.stringify({ capacityM2: 30, name: "Evento", spaceType: "casa" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const pkg = (await createRes.json()) as { id: string };

      // Primera pista (16 m² <= 30 m²) -> Éxito (versión 2)
      const res1 = await packageController.handleAddItem(
        new Request(`http://localhost/api/packages/${pkg.id}/items`, {
          body: JSON.stringify({ moduleId: MOD_PISTA }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );
      expect(res1.status).toBe(201);

      // Segunda pista (16 + 16 = 32 m² > 30 m²) -> 201: ya no bloquea.
      const res2 = await packageController.handleAddItem(
        new Request(`http://localhost/api/packages/${pkg.id}/items`, {
          body: JSON.stringify({ moduleId: MOD_PISTA }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );
      expect(res2.status).toBe(201);

      // El cambio se persiste y emite un evento por cada módulo agregado.
      const itemsCount = await db.query<{ count: string }>(
        `SELECT count(*) FROM public.package_items WHERE package_id = $1`,
        [pkg.id],
      );
      expect(Number(itemsCount.rows[0].count)).toBe(2);

      const eventsCount = await db.query<{ count: string }>(
        `SELECT count(*) FROM private.domain_events WHERE package_id = $1`,
        [pkg.id],
      );
      expect(Number(eventsCount.rows[0].count)).toBe(2);
    });

    it("Rollback atómico: colisión de evento en outbox no deja package_items parciales ni sube versión", async () => {
      // Paquete creado en PostgreSQL
      const pkgId = randomUUID();
      await db.query(
        `INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version) VALUES ($1, $2, 'casa', 50, 1)`,
        [pkgId, USER_A],
      );

      const duplicateEventId = "collision-event-uuid";
      const validEvent = {
        eventId: duplicateEventId,
        occurredAt: "2026-10-12T12:00:00.000Z",
        packageId: pkgId,
        payload: { itemId: randomUUID(), moduleId: MOD_MESA },
        schemaVersion: 1,
        type: "package.module.added",
        userId: USER_A,
      };

      // 1. Commit exitoso
      await db.query(`SELECT public.commit_package_change($1::jsonb);`, [JSON.stringify(validEvent)]);

      // 2. Segundo commit colisionando el eventId
      const collidingEvent = {
        ...validEvent,
        payload: { itemId: randomUUID(), moduleId: MOD_PISTA },
      };

      await expect(
        db.query(`SELECT public.commit_package_change($1::jsonb);`, [JSON.stringify(collidingEvent)]),
      ).rejects.toThrow("event.duplicate");

      // Verificación de atomicidad: la versión se mantuvo en 2 y sólo hay 1 ítem persistido
      const items = await db.query<{ count: string }>(
        `SELECT count(*) FROM public.package_items WHERE package_id = $1`,
        [pkgId],
      );
      expect(Number(items.rows[0].count)).toBe(1);

      const pkgVersion = await db.query<{ version: number }>(
        `SELECT version FROM public.packages WHERE id = $1`,
        [pkgId],
      );
      expect(pkgVersion.rows[0].version).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Prototype y Clonación Profunda (POST /packages/{id}/clone - DECOR-24)
  // --------------------------------------------------------------------------
  describe("3. Prototype y clonación profunda (DECOR-24)", () => {
    it("clona profundamente paquetes con ítems y garantiza independencia absoluta del original", async () => {
      const { packageController } = createControllerContext(userA);

      // 1. Crear paquete original con 2 ítems
      const origRes = await packageController.handleCreatePackage(
        new Request("http://localhost/api/packages", {
          body: JSON.stringify({ capacityM2: 40, name: "Evento", spaceType: "salonSocial" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const orig = (await origRes.json()) as { id: string };
      await packageController.handleAddItem(
        new Request(`http://localhost/api/packages/${orig.id}/items`, {
          body: JSON.stringify({ moduleId: MOD_ARCO }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        orig.id,
      );
      await packageController.handleAddItem(
        new Request(`http://localhost/api/packages/${orig.id}/items`, {
          body: JSON.stringify({ moduleId: MOD_MESA }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        orig.id,
      );

      // 2. Clonar el paquete
      const cloneRes = await packageController.handleClonePackage(
        new Request(`http://localhost/api/packages/${orig.id}/clone`, { method: "POST" }),
        orig.id,
      );
      expect(cloneRes.status).toBe(201);
      const clone = (await cloneRes.json()) as { id: string; itemCount: number; version: number };

      expect(clone.id).not.toBe(orig.id);
      expect(clone.version).toBe(1); // El clon nace en versión 1
      expect(clone.itemCount).toBe(2);

      // 3. Modificar el clon: eliminar un ítem del clon
      const cloneItems = await db.query<{ id: string }>(
        `SELECT id FROM public.package_items WHERE package_id = $1`,
        [clone.id],
      );
      expect(cloneItems.rows).toHaveLength(2);

      const deleteRes = await packageController.handleRemoveItem(
        clone.id,
        cloneItems.rows[0].id,
        new Request(`http://localhost/api/packages/${clone.id}/items/${cloneItems.rows[0].id}`, { method: "DELETE" }),
      );
      expect(deleteRes.status).toBe(204);

      // 4. Comprobar independencia: el clon tiene 1 ítem, el original sigue teniendo 2 ítems
      const cloneItemsAfter = await db.query<{ count: string }>(
        `SELECT count(*) FROM public.package_items WHERE package_id = $1`,
        [clone.id],
      );
      expect(Number(cloneItemsAfter.rows[0].count)).toBe(1);

      const origItemsAfter = await db.query<{ count: string }>(
        `SELECT count(*) FROM public.package_items WHERE package_id = $1`,
        [orig.id],
      );
      expect(Number(origItemsAfter.rows[0].count)).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Composite: Grupos, Niveles y Prevención de Ciclos (DECOR-25)
  // --------------------------------------------------------------------------
  describe("4. Composite para grupos decorativos (DECOR-25)", () => {
    it("crea la 'Zona de bienvenida' agrupando módulos con éxito (201 Created)", async () => {
      const { packageController } = createControllerContext(userA);

      const pkgRes = await packageController.handleCreatePackage(
        new Request("http://localhost/api/packages", {
          body: JSON.stringify({ capacityM2: 50, name: "Evento", spaceType: "salonSocial" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const pkg = (await pkgRes.json()) as { id: string };

      const groupRes = await packageController.handleCreateGroup(
        new Request(`http://localhost/api/packages/${pkg.id}/groups`, {
          body: JSON.stringify({
            children: [{ moduleId: MOD_ARCO }, { moduleId: MOD_MESA }],
            name: "Zona de bienvenida",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );

      expect(groupRes.status).toBe(201);
      const group = (await groupRes.json()) as {
        depth: number;
        itemIds: string[];
        name: string;
        packageVersion: number;
      };
      expect(group.name).toBe("Zona de bienvenida");
      expect(group.depth).toBe(1);
      expect(group.itemIds).toHaveLength(2);
      expect(group.packageVersion).toBe(3);
    });

    it("permite 3 niveles de profundidad jerárquica y rechaza el 4to nivel con 422", async () => {
      const { packageController } = createControllerContext(userA);

      const pkgRes = await packageController.handleCreatePackage(
        new Request("http://localhost/api/packages", {
          body: JSON.stringify({ capacityM2: 50, name: "Evento", spaceType: "salonSocial" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const pkg = (await pkgRes.json()) as { id: string };

      // Nivel 1
      const g1Res = await packageController.handleCreateGroup(
        new Request(`http://localhost/api/packages/${pkg.id}/groups`, {
          body: JSON.stringify({ name: "Nivel 1" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );
      const g1 = (await g1Res.json()) as { depth: number; groupId: string };
      expect(g1.depth).toBe(1);

      // Nivel 2
      const g2Res = await packageController.handleCreateGroup(
        new Request(`http://localhost/api/packages/${pkg.id}/groups`, {
          body: JSON.stringify({ name: "Nivel 2", parentGroupId: g1.groupId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );
      const g2 = (await g2Res.json()) as { depth: number; groupId: string };
      expect(g2.depth).toBe(2);

      // Nivel 3
      const g3Res = await packageController.handleCreateGroup(
        new Request(`http://localhost/api/packages/${pkg.id}/groups`, {
          body: JSON.stringify({ name: "Nivel 3", parentGroupId: g2.groupId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );
      const g3 = (await g3Res.json()) as { depth: number; groupId: string };
      expect(g3.depth).toBe(3);

      // Intento de Nivel 4 -> Rechazado con 422 (package.group_depth_exceeded)
      const g4Res = await packageController.handleCreateGroup(
        new Request(`http://localhost/api/packages/${pkg.id}/groups`, {
          body: JSON.stringify({ name: "Nivel 4", parentGroupId: g3.groupId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );
      expect(g4Res.status).toBe(422);
      const err = (await g4Res.json()) as { error: { code: string } };
      expect(err.error.code).toBe("package.group_depth_exceeded");
    });

    it("previene ciclos estructurales: inmutabilidad de parent_group_id y validación en dominio", async () => {
      const pkgId = randomUUID();
      await db.query(
        `INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version) VALUES ($1, $2, 'casa', 50, 1)`,
        [pkgId, USER_A],
      );
      const parentId = randomUUID();
      const childId = randomUUID();
      await db.query(
        `INSERT INTO public.package_groups (id, package_id, parent_group_id, name, depth) VALUES ($1, $2, NULL, 'Padre', 1)`,
        [parentId, pkgId],
      );
      await db.query(
        `INSERT INTO public.package_groups (id, package_id, parent_group_id, name, depth) VALUES ($1, $2, $3, 'Hijo', 2)`,
        [childId, pkgId, parentId],
      );

      // Intentar reasignar el padre para crear un ciclo Padre -> Hijo -> Padre
      await expect(
        db.query(`UPDATE public.package_groups SET parent_group_id = $1 WHERE id = $2`, [childId, parentId]),
      ).rejects.toMatchObject({ message: expect.stringContaining("package.group_cycle") });
    });
  });

  // --------------------------------------------------------------------------
  // 5. Seguridad, Ownership y Aislamiento de Usuarios (A/B y Anónimo - DECOR-30)
  // --------------------------------------------------------------------------
  describe("5. Seguridad, ownership y autorización A/B (DECOR-30)", () => {
    it("anónimo no autenticado es rechazado con 401 Unauthorized", async () => {
      const { packageController } = createControllerContext(null); // Sin sesión

      const res = await packageController.handleCreatePackage(
        new Request("http://localhost/api/packages", {
          body: JSON.stringify({ capacityM2: 30, name: "Evento", spaceType: "casa" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("auth.unauthenticated");
    });

    it("Usuario B no puede acceder, mutar ni clonar paquetes de Usuario A (responde 404 para evitar enumeración)", async () => {
      // 1. Usuario A crea un paquete
      const ctxA = createControllerContext(userA);
      const pkgRes = await ctxA.packageController.handleCreatePackage(
        new Request("http://localhost/api/packages", {
          body: JSON.stringify({ capacityM2: 30, name: "Evento", spaceType: "casa" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const pkg = (await pkgRes.json()) as { id: string };

      // 2. Usuario B intenta interactuar con el paquete de A
      const ctxB = createControllerContext(userB);

      // B intenta agregar ítem a paquete de A
      const addRes = await ctxB.packageController.handleAddItem(
        new Request(`http://localhost/api/packages/${pkg.id}/items`, {
          body: JSON.stringify({ moduleId: MOD_MESA }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );
      expect(addRes.status).toBe(404);
      expect(((await addRes.json()) as { error: { code: string } }).error.code).toBe("package.not_found");

      // B intenta clonar paquete de A
      const cloneRes = await ctxB.packageController.handleClonePackage(
        new Request(`http://localhost/api/packages/${pkg.id}/clone`, { method: "POST" }),
        pkg.id,
      );
      expect(cloneRes.status).toBe(404);
      expect(((await cloneRes.json()) as { error: { code: string } }).error.code).toBe("package.not_found");

      // B intenta crear grupo en paquete de A
      const groupRes = await ctxB.packageController.handleCreateGroup(
        new Request(`http://localhost/api/packages/${pkg.id}/groups`, {
          body: JSON.stringify({ name: "Intruso" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        pkg.id,
      );
      expect(groupRes.status).toBe(404);
      expect(((await groupRes.json()) as { error: { code: string } }).error.code).toBe("package.not_found");
    });
  });

  // --------------------------------------------------------------------------
  // 6. Manejo de Errores Controlados y Observabilidad (Actividad.md 8.17 - 8.18)
  // --------------------------------------------------------------------------
  describe("6. Manejo de errores controlados y observabilidad (8.17 / 8.18)", () => {
    it("responde 400 Bad Request ante cuerpo malformado o campos inválidos", async () => {
      const { packageController } = createControllerContext(userA);

      // Body que no es JSON válido
      const badReq = new Request("http://localhost/api/packages", {
        body: "esto no es json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const res = await packageController.handleCreatePackage(badReq);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("package.invalid_body");
    });

    it("propaga y genera correlationId en cabecera x-correlation-id para trazabilidad", async () => {
      const { packageController } = createControllerContext(userA);

      const customCorrId = "trace-uuid-123456";
      const req = new Request("http://localhost/api/packages", {
        body: JSON.stringify({ capacityM2: 30, name: "Evento", spaceType: "casa" }),
        headers: {
          "Content-Type": "application/json",
          "x-correlation-id": customCorrId,
        },
        method: "POST",
      });

      const res = await packageController.handleCreatePackage(req);
      expect(res.status).toBe(201);
      expect(res.headers.get("x-correlation-id")).toBe(customCorrId);
    });

    it("errores no filtran stack traces ni datos sensibles en respuestas 500", async () => {
      // Simular fallo inesperado interno
      const sessionGateway: Pick<SessionGateway, "currentUser"> = { currentUser: async () => userA };
      const failingRepo: PackageRepository = {
        create: vi.fn().mockRejectedValue(new Error("FATAL: connection leaked internal db string")),
        updateMetadata: vi.fn(),
        clone: vi.fn(),
      };
      const controller = new PackageController(
        sessionGateway,
        new AuthorizePackageAccessUseCase(sessionGateway, { findOwnerId: vi.fn() }),
        new CreatePackageUseCase(failingRepo),
        {} as unknown as AddModuleToPackageUseCase,
        {} as unknown as RemoveModuleFromPackageUseCase,
        { drainOutbox: { execute: vi.fn() } as unknown as Pick<DrainOutboxUseCase, "execute"> },
      );

      const res = await controller.handleCreatePackage(
        new Request("http://localhost/api/packages", {
          body: JSON.stringify({ capacityM2: 30, name: "Evento", spaceType: "casa" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("internal_error");
      expect(body.error.message).toBe("No pudimos completar la operación.");
      expect(res.headers.get("x-correlation-id")).toBeDefined();
      // Garantizar que la excepción interna no se filtra al cliente
      expect(JSON.stringify(body)).not.toContain("FATAL: connection leaked");
    });
  });
});
