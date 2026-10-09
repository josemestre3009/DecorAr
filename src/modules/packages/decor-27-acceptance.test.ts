// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import { CATALOGO_CANONICO } from "./domain/catalog-fixtures";
import { PaqueteDecoracionBuilderImpl } from "./domain/decoration-package-builder-impl";
import { DirectorEvento } from "./domain/director-evento";
import { AddModuleToPackageUseCase } from "./application/use-cases/add-module-to-package.use-case";
import { PackageController } from "../../interfaces/packages/package-controller";
import type { AuthorizePackageAccessUseCase } from "./application/authorize-package-access.use-case";
import type { CreatePackageUseCase } from "./application/use-cases/create-package.use-case";
import type { RemoveModuleFromPackageUseCase } from "./application/use-cases/remove-module-from-package.use-case";
import type { PackageReader } from "./application/ports/package-reader.port";
import type { CatalogModuleReader } from "./application/ports/catalog-module-reader.port";
import type { PackageChangeOutbox } from "../events/application/outbox";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULE_FIXTURE_ID = "44444444-4444-4444-8444-444444444444";

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

describe("DECOR-27 Criterios de Aceptación", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);

    const dir = resolve("supabase/migrations");
    const sqlFiles = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const sqlFile of sqlFiles) {
      await db.exec(await readFile(resolve(dir, sqlFile), "utf8"));
    }

    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
      INSERT INTO public.catalog_modules (
        id, asset_id, version, name, price_cop, area_m2, width_m, height_m, depth_m,
        glb_url, usdz_url, poster_url, status
      ) VALUES (
        '${MODULE_FIXTURE_ID}', 'fixture', 1, 'Pista de baile 4x4', 600000, 16, 4, 1, 4,
        'https://example.com/pista.glb', 'https://example.com/pista.usdz', 'https://example.com/pista.webp', 'active'
      );
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  // --------------------------------------------------------------------------
  // Criterio 1: Fixture 30 y capacidad configurable
  // --------------------------------------------------------------------------
  describe("1. Fixture 30 y capacidad configurable", () => {
    it("con fixture de 30 m² acepta 1 pista (16 m²) y rechaza la 2da pista (32 > 30 m²)", () => {
      const builder = new PaqueteDecoracionBuilderImpl("casa", 30);

      const add1 = builder.agregarModulo(CATALOGO_CANONICO.pistaBaile);
      expect(add1.ok).toBe(true);

      const add2 = builder.agregarModulo(CATALOGO_CANONICO.pistaBaile);
      expect(add2.ok).toBe(false);
      if (!add2.ok) {
        expect(add2.error.code).toBe("package.capacity_exceeded");
        expect(add2.error.message).toContain("excede la capacidad del espacio (32/30 m²)");
      }

      const paquete = builder.construir();
      expect(paquete.espacioUsadoM2).toBe(16);
      expect(paquete.modulos).toHaveLength(1);
    });

    it("con capacidad configurable de 50 m², acepta 2 pistas (32 <= 50 m²)", () => {
      const builder = new PaqueteDecoracionBuilderImpl("salonSocial", 50);

      expect(builder.agregarModulo(CATALOGO_CANONICO.pistaBaile).ok).toBe(true);
      expect(builder.agregarModulo(CATALOGO_CANONICO.pistaBaile).ok).toBe(true);

      const paquete = builder.construir();
      expect(paquete.espacioUsadoM2).toBe(32);
      expect(paquete.modulos).toHaveLength(2);
    });

    it("DirectorEvento construye paquete básico con nombres canónicos", () => {
      const builder = new PaqueteDecoracionBuilderImpl("aireLibre", 40);
      const director = new DirectorEvento();

      const paquete = director.construirPaqueteBasico(builder);
      expect(paquete.tipoEspacio).toBe("aireLibre");
      expect(paquete.modulos).toHaveLength(3); // 1 arco + 2 mesas
      expect(paquete.espacioUsadoM2).toBe(10); // 2 + 4 + 4
      expect(paquete.presupuestoTotal).toBe(700000);
    });
  });

  // --------------------------------------------------------------------------
  // Criterio 2: Fallo de inserción outbox revierte paquete/item
  // --------------------------------------------------------------------------
  describe("2. Fallo de inserción outbox revierte paquete/item (Rollback atómico)", () => {
    it("falla si hay duplicate eventId y revierte la inserción de package_items en Postgres", async () => {
      // 1. Crear paquete para USER_A
      const pkgId = "22222222-2222-4222-8222-222222222222";
      await db.exec(`
        INSERT INTO public.packages (id, user_id, version, space_type, capacity_m2)
        VALUES ('${pkgId}', '${USER_A}', 1, 'casa', 30);
      `);

      const itemId1 = "33333333-3333-4333-8333-333333333331";
      const duplicateEventId = "evt-duplicate-123";

      const validEvent = {
        eventId: duplicateEventId,
        occurredAt: "2026-10-08T12:00:00.000Z",
        packageId: pkgId,
        payload: { itemId: itemId1, moduleId: MODULE_FIXTURE_ID },
        schemaVersion: 1,
        type: "package.module.added",
        userId: USER_A,
      };

      // Inserción 1: exitosa
      const res1 = await db.query<{ version: number }>(
        `SELECT public.commit_package_change($1::jsonb) as version;`,
        [JSON.stringify(validEvent)],
      );
      expect(res1.rows[0].version).toBe(2);

      // Comprobar que el ítem está
      const check1 = await db.query(`SELECT id FROM public.package_items WHERE id = '${itemId1}'`);
      expect(check1.rows).toHaveLength(1);

      // Inserción 2: intenta agregar otro itemId pero con el MISMO eventId (colisión outbox)
      const itemId2 = "33333333-3333-4333-8333-333333333332";
      const collidingEvent = {
        ...validEvent,
        eventId: duplicateEventId,
        payload: { itemId: itemId2, moduleId: MODULE_FIXTURE_ID },
      };

      await expect(
        db.query(`SELECT public.commit_package_change($1::jsonb);`, [JSON.stringify(collidingEvent)]),
      ).rejects.toThrow("event.duplicate");

      // Comprobar rollback: itemId2 NO fue insertado y la versión del paquete sigue en 2
      const check2 = await db.query(`SELECT id FROM public.package_items WHERE id = '${itemId2}'`);
      expect(check2.rows).toHaveLength(0);

      const pkgCheck = await db.query<{ version: number }>(
        `SELECT version FROM public.packages WHERE id = '${pkgId}'`,
      );
      expect(pkgCheck.rows[0].version).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Criterio 3: Rechazo de validación deja cero escritura/evento
  // --------------------------------------------------------------------------
  describe("3. Rechazo deja cero escritura/evento", () => {
    it("si la capacidad es excedida, la aplicación no llama a la outbox ni crea ítems", async () => {
      const mockOutbox = {
        commit: vi.fn(),
      };

      const mockPackageReader = {
        getItemModuleId: vi.fn(),
        getPackage: vi.fn().mockResolvedValue(
          ok({
            capacityM2: 20,
            id: "pkg-cap",
            items: [{ areaM2: 16, itemId: "it-1", moduleId: "mod-1" }],
            spaceType: "casa",
            userId: "user-1",
            version: 1,
          }),
        ),
      };

      const mockCatalogReader = {
        getModuleById: vi.fn().mockResolvedValue(
          ok({
            areaM2: 16,
            id: "mod-2",
            name: "Pista de baile",
            priceCop: 600000,
          }),
        ),
      };

      const useCase = new AddModuleToPackageUseCase(
        mockPackageReader as unknown as PackageReader,
        mockCatalogReader as unknown as CatalogModuleReader,
        mockOutbox as unknown as PackageChangeOutbox,
        { now: () => new Date() },
        { generate: () => "uuid" },
      );

      const result = await useCase.execute({
        moduleId: "mod-2",
        packageId: "pkg-cap",
        userId: "user-1",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("package.capacity_exceeded");
      }

      // Verificación estricta: cero escritura a outbox
      expect(mockOutbox.commit).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Criterio 4: Anónimo y ajeno rechazados por handler y RLS
  // --------------------------------------------------------------------------
  describe("4. Anónimo y ajeno rechazados por handler y RLS", () => {
    const emptyUseCase = { execute: vi.fn() };

    it("Route Handler rechaza anónimo con 401", async () => {
      const authorizePackageAccess = {
        execute: vi.fn().mockResolvedValue(
          err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
        ),
      };

      const controller = new PackageController(
        { currentUser: vi.fn().mockResolvedValue(null) },
        authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
        emptyUseCase as unknown as CreatePackageUseCase,
        emptyUseCase as unknown as AddModuleToPackageUseCase,
        emptyUseCase as unknown as RemoveModuleFromPackageUseCase,
      );

      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("auth.unauthenticated");
    });

    it("Route Handler rechaza ajeno con 404 para evitar enumeración", async () => {
      const authorizePackageAccess = {
        execute: vi.fn().mockResolvedValue(
          err(new DomainError("package.not_found", "No encontramos este paquete.")),
        ),
      };

      const controller = new PackageController(
        { currentUser: vi.fn().mockResolvedValue({ email: "b@test.com", id: USER_B } as SessionUser) },
        authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
        emptyUseCase as unknown as CreatePackageUseCase,
        emptyUseCase as unknown as AddModuleToPackageUseCase,
        emptyUseCase as unknown as RemoveModuleFromPackageUseCase,
      );

      const req = new Request("http://localhost/api/packages/pkg-a/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await controller.handleAddItem(req, "pkg-a");
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("package.not_found");
    });

    it("RLS en Postgres bloquea lectura de paquete ajeno y bloquea a anónimo", async () => {
      // Restablecer rol a superuser/postgres para el setup
      await db.exec(`RESET ROLE;`);
      const testPkg = "55555555-5555-4555-8555-555555555555";
      await db.exec(`
        INSERT INTO public.packages (id, user_id, version, space_type, capacity_m2)
        VALUES ('${testPkg}', '${USER_A}', 1, 'salonSocial', 100);
      `);

      // 1. Anónimo intentando leer: sin grant SELECT, permiso denegado
      await db.exec(`SET ROLE anon; SET request.jwt.claim.sub = '';`);
      await expect(
        db.query(`SELECT * FROM public.packages WHERE id = '${testPkg}'`),
      ).rejects.toThrow(/permission denied/);

      // 2. USER_B (ajeno) intentando leer paquete de USER_A: RLS filtra y retorna 0 filas
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${USER_B}';`);
      const bRead = await db.query(`SELECT * FROM public.packages WHERE id = '${testPkg}'`);
      expect(bRead.rows).toHaveLength(0);

      // 3. USER_A (propietario) leyendo su propio paquete: RLS permite y retorna 1 fila
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${USER_A}';`);
      const aRead = await db.query(`SELECT * FROM public.packages WHERE id = '${testPkg}'`);
      expect(aRead.rows).toHaveLength(1);

      await db.exec(`RESET ROLE;`);
    });
  });

  // --------------------------------------------------------------------------
  // Criterio 5: Commit atómico antes de publicación
  // --------------------------------------------------------------------------
  describe("5. Commit atómico antes de publicación", () => {
    const emptyUseCase = { execute: vi.fn() };

    it("garantiza que la outbox se drena SOLO tras el éxito del commit en la base de datos", async () => {
      const executionOrder: string[] = [];

      const mockOutbox = {
        commit: vi.fn().mockImplementation(async () => {
          executionOrder.push("commit_db");
          return ok(2);
        }),
      };

      const mockDrain = {
        execute: vi.fn().mockImplementation(async () => {
          executionOrder.push("drain_publish");
          return ok({ claimed: 1, failed: 0, published: 1 });
        }),
      };

      const mockAddUseCase = {
        execute: vi.fn().mockImplementation(async () => {
          await mockOutbox.commit();
          return ok({ itemId: "item-new", packageVersion: 2 });
        }),
      };

      const controller = new PackageController(
        { currentUser: vi.fn().mockResolvedValue({ email: "user@test.com", id: "user-1" } as SessionUser) },
        { execute: vi.fn().mockResolvedValue(ok({ email: "user@test.com", id: "user-1" })) } as unknown as AuthorizePackageAccessUseCase,
        emptyUseCase as unknown as CreatePackageUseCase,
        mockAddUseCase as unknown as AddModuleToPackageUseCase,
        emptyUseCase as unknown as RemoveModuleFromPackageUseCase,
        mockDrain,
      );

      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(201);

      // Se comprueba el orden exacto: commit antes de publicar
      expect(executionOrder).toEqual(["commit_db", "drain_publish"]);
    });

    it("si el commit falla, drain/publish NUNCA se ejecuta", async () => {
      const mockDrain = {
        execute: vi.fn(),
      };

      const mockAddUseCase = {
        execute: vi.fn().mockResolvedValue(
          err(new DomainError("outbox.persistence_error", "DB failure")),
        ),
      };

      const controller = new PackageController(
        { currentUser: vi.fn().mockResolvedValue({ email: "user@test.com", id: "user-1" } as SessionUser) },
        { execute: vi.fn().mockResolvedValue(ok({ email: "user@test.com", id: "user-1" })) } as unknown as AuthorizePackageAccessUseCase,
        emptyUseCase as unknown as CreatePackageUseCase,
        mockAddUseCase as unknown as AddModuleToPackageUseCase,
        emptyUseCase as unknown as RemoveModuleFromPackageUseCase,
        mockDrain,
      );

      const req = new Request("http://localhost/api/packages/pkg-1/items", {
        body: JSON.stringify({ moduleId: "mod-1" }),
        method: "POST",
      });

      const res = await controller.handleAddItem(req, "pkg-1");
      expect(res.status).toBe(500);

      // Drain no se ejecuta si el commit falló
      expect(mockDrain.execute).not.toHaveBeenCalled();
    });
  });
});
