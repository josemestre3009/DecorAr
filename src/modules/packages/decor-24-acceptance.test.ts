// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err } from "../../shared/domain/result";
import { PackageController } from "../../interfaces/packages/package-controller";
import type { AuthorizePackageAccessUseCase } from "./application/authorize-package-access.use-case";
import { ClonePackageUseCase } from "./application/use-cases/clone-package.use-case";
import type { CreatePackageUseCase } from "./application/use-cases/create-package.use-case";
import type { AddModuleToPackageUseCase } from "./application/use-cases/add-module-to-package.use-case";
import type { RemoveModuleFromPackageUseCase } from "./application/use-cases/remove-module-from-package.use-case";


const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULE_MESA_ID = "11111111-1111-4111-8111-111111111111";
const MODULE_ARCO_ID = "22222222-2222-4222-8222-222222222222";

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

describe("DECOR-24 Criterios de Aceptación: Prototype y Clonación Profunda", () => {
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
      ) VALUES
      (
        '${MODULE_MESA_ID}', 'mesa-redonda', 1, 'Mesa Redonda Fixture', 150000, 4, 2, 1, 2,
        'https://example.com/mesa.glb', 'https://example.com/mesa.usdz', 'https://example.com/mesa.webp', 'active'
      ),
      (
        '${MODULE_ARCO_ID}', 'arco-floral', 2, 'Arco Floral Fixture', 400000, 6, 3, 2, 1,
        'https://example.com/arco.glb', 'https://example.com/arco.usdz', 'https://example.com/arco.webp', 'active'
      );
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  // --------------------------------------------------------------------------
  // Criterio 1: Independencia (Valores idénticos, IDs distintos, mutaciones independientes)
  // --------------------------------------------------------------------------
  describe("1. Independencia: Valores idénticos, IDs distintos y mutaciones desacopladas", () => {
    it("clona profundamente paquete e items generando nuevos identificadores sin alterar el original", async () => {
      const sourcePkgId = "10000000-0000-4000-8000-000000000001";
      const sourceItemId1 = "20000000-0000-4000-8000-000000000001";
      const sourceItemId2 = "20000000-0000-4000-8000-000000000002";

      // 1. Insertamos un paquete original con items y preferencias
      await db.exec(`
        INSERT INTO public.packages (
          id, user_id, space_type, capacity_m2, style, colors, notes, version
        ) VALUES (
          '${sourcePkgId}', '${USER_A}', 'salonSocial', 40.00, 'elegante',
          '["#ffffff", "#000000"]'::jsonb, 'Mesa central y arco bienvenida', 3
        );

        INSERT INTO public.package_items (id, package_id, module_id)
        VALUES
          ('${sourceItemId1}', '${sourcePkgId}', '${MODULE_MESA_ID}'),
          ('${sourceItemId2}', '${sourcePkgId}', '${MODULE_ARCO_ID}');
      `);

      // 2. Ejecutamos la RPC clone_package
      const cloneResult = await db.query<{ clone_package: {
        id: string;
        spaceType: string;
        capacityM2: number;
        style: string;
        colors: string[];
        notes: string;
        version: number;
        itemCount: number;
      } }>(`
        SELECT public.clone_package('${sourcePkgId}'::uuid, '${USER_A}'::uuid) AS clone_package;
      `);

      const cloned = cloneResult.rows[0].clone_package;
      expect(cloned.id).toBeDefined();
      expect(cloned.id).not.toBe(sourcePkgId);
      expect(cloned.spaceType).toBe("salonSocial");
      expect(Number(cloned.capacityM2)).toBe(40);
      expect(cloned.style).toBe("elegante");
      expect(cloned.colors).toEqual(["#ffffff", "#000000"]);
      expect(cloned.notes).toBe("Mesa central y arco bienvenida");
      expect(cloned.version).toBe(1);
      expect(cloned.itemCount).toBe(2);

      // 3. Verificamos los items clonados en la base de datos
      const clonedItemsResult = await db.query<{ id: string; module_id: string }>(`
        SELECT id, module_id FROM public.package_items WHERE package_id = '${cloned.id}' ORDER BY module_id;
      `);

      expect(clonedItemsResult.rows).toHaveLength(2);
      const clonedItemIds = clonedItemsResult.rows.map((r) => r.id);
      expect(clonedItemIds).not.toContain(sourceItemId1);
      expect(clonedItemIds).not.toContain(sourceItemId2);

      // Los módulos referenciados deben ser exactamente los mismos
      const clonedModuleIds = clonedItemsResult.rows.map((r) => r.module_id);
      expect(clonedModuleIds).toContain(MODULE_MESA_ID);
      expect(clonedModuleIds).toContain(MODULE_ARCO_ID);

      // 4. Mutación independiente: eliminamos un ítem del clon y verificamos que el original no se altera
      await db.exec(`
        DELETE FROM public.package_items WHERE id = '${clonedItemsResult.rows[0].id}';
      `);

      const sourceItemsCount = await db.query<{ count: string }>(`
        SELECT count(*) AS count FROM public.package_items WHERE package_id = '${sourcePkgId}';
      `);
      expect(Number(sourceItemsCount.rows[0].count)).toBe(2);

      const cloneItemsCount = await db.query<{ count: string }>(`
        SELECT count(*) AS count FROM public.package_items WHERE package_id = '${cloned.id}';
      `);
      expect(Number(cloneItemsCount.rows[0].count)).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Criterio 2: Rollback Atómico (Cero clones parciales si falla un elemento hijo)
  // --------------------------------------------------------------------------
  describe("2. Rollback atómico: Cero clones parciales ante cualquier error en la transacción", () => {
    it("si la inserción de items falla, el paquete clonado completo se revierte", async () => {
      const sourcePkgId = "10000000-0000-4000-8000-000000000002";
      await db.exec(`
        INSERT INTO public.packages (
          id, user_id, space_type, capacity_m2, style, notes, version
        ) VALUES (
          '${sourcePkgId}', '${USER_A}', 'casa', 20.00, 'rustico', 'Para rollback', 1
        );

        INSERT INTO public.package_items (id, package_id, module_id)
        VALUES ('20000000-0000-4000-8000-000000000003', '${sourcePkgId}', '${MODULE_MESA_ID}');
      `);

      const totalPackagesBefore = await db.query<{ count: string }>(`
        SELECT count(*) AS count FROM public.packages;
      `);

      // Creamos un trigger temporal que falla al insertar un item en el paquete clonado
      await db.exec(`
        CREATE OR REPLACE FUNCTION trigger_fail_on_clone()
        RETURNS trigger AS $$
        BEGIN
          IF NEW.package_id <> '${sourcePkgId}'::uuid THEN
            RAISE EXCEPTION 'simulated_item_insert_failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_fail_item_insert
        BEFORE INSERT ON public.package_items
        FOR EACH ROW EXECUTE FUNCTION trigger_fail_on_clone();
      `);

      // Intentamos clonar; debe fallar la transacción completa
      let errorThrown = false;
      try {
        await db.query(`SELECT public.clone_package('${sourcePkgId}'::uuid, '${USER_A}'::uuid);`);
      } catch (err: unknown) {
        errorThrown = true;
        expect((err as Error).message).toContain("simulated_item_insert_failure");
      }
      expect(errorThrown).toBe(true);

      // Verificamos que no quedó ningún paquete huérfano ni parcial
      const totalPackagesAfter = await db.query<{ count: string }>(`
        SELECT count(*) AS count FROM public.packages;
      `);
      expect(totalPackagesAfter.rows[0].count).toBe(totalPackagesBefore.rows[0].count);

      // Limpiamos el trigger de prueba
      await db.exec(`
        DROP TRIGGER trg_fail_item_insert ON public.package_items;
        DROP FUNCTION trigger_fail_on_clone();
      `);
    });
  });

  // --------------------------------------------------------------------------
  // Criterio 3: Autorización y Seguridad (ID ajeno o inexistente rechazado con sobre canónico)
  // --------------------------------------------------------------------------
  describe("3. Autorización y Seguridad: Rechazo de solicitudes sobre paquetes ajenos o sin sesión", () => {
    it("Route Handler rechaza petición anónima con 401 y sobre de error", async () => {
      const authorizePackageAccess = {
        execute: vi.fn().mockResolvedValue(
          err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
        ),
      };

      const emptyUseCase = {} as unknown;
      const controller = new PackageController(
        { currentUser: vi.fn().mockResolvedValue(null) },
        authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
        emptyUseCase as CreatePackageUseCase,
        emptyUseCase as AddModuleToPackageUseCase,
        emptyUseCase as RemoveModuleFromPackageUseCase,
        emptyUseCase as ClonePackageUseCase,
      );

      const req = new Request("http://localhost/api/packages/pkg-123/clone", {
        method: "POST",
      });

      const res = await controller.handleClonePackage(req, "pkg-123");
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({
        error: {
          code: "auth.unauthenticated",
          message: "Inicia sesión para continuar.",
        },
      });
    });

    it("Route Handler rechaza clonación de paquete ajeno o inexistente con 404 (evita enumeración)", async () => {
      const authorizePackageAccess = {
        execute: vi.fn().mockResolvedValue(
          err(new DomainError("package.not_found", "No encontramos este paquete de decoración.")),
        ),
      };

      const emptyUseCase = {} as unknown;
      const controller = new PackageController(
        { currentUser: vi.fn().mockResolvedValue({ email: "user_b@example.com", id: USER_B }) },
        authorizePackageAccess as unknown as AuthorizePackageAccessUseCase,
        emptyUseCase as CreatePackageUseCase,
        emptyUseCase as AddModuleToPackageUseCase,
        emptyUseCase as RemoveModuleFromPackageUseCase,
        emptyUseCase as ClonePackageUseCase,
      );

      const req = new Request("http://localhost/api/packages/pkg-de-otro/clone", {
        method: "POST",
      });

      const res = await controller.handleClonePackage(req, "pkg-de-otro");
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json).toEqual({
        error: {
          code: "package.not_found",
          message: "No encontramos este paquete de decoración.",
        },
      });
    });

    it("PostgreSQL RLS oculta paquetes de otros usuarios ante consultas directas autenticadas", async () => {
      const pkgId = "10000000-0000-4000-8000-000000000003";
      await db.exec(`
        INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version)
        VALUES ('${pkgId}', '${USER_A}', 'salonSocial', 30, 1);
      `);

      // Actuamos como USER_B autenticado
      await db.exec(`
        SET ROLE authenticated;
        SET request.jwt.claim.sub = '${USER_B}';
      `);

      const result = await db.query(`SELECT * FROM public.packages WHERE id = '${pkgId}';`);
      expect(result.rows).toHaveLength(0);

      // Restauramos rol de sesión inicial
      await db.exec(`
        RESET ROLE;
        SET request.jwt.claim.sub = '';
      `);
    });
  });

  // --------------------------------------------------------------------------
  // Criterio 4: Cero eventos de dominio en outbox al clonar
  // --------------------------------------------------------------------------
  describe("4. Comportamiento ante eventos: El clon no emite evento de dominio ni recalcula hasta mutación", () => {
    it("la clonación atómica no registra filas en private.domain_events", async () => {
      const sourcePkgId = "10000000-0000-4000-8000-000000000004";
      await db.exec(`
        INSERT INTO public.packages (id, user_id, space_type, capacity_m2, version)
        VALUES ('${sourcePkgId}', '${USER_A}', 'aireLibre', 50, 1);
      `);

      const eventsBefore = await db.query<{ count: string }>(`
        SELECT count(*) AS count FROM private.domain_events;
      `);

      await db.query(`
        SELECT public.clone_package('${sourcePkgId}'::uuid, '${USER_A}'::uuid);
      `);

      const eventsAfter = await db.query<{ count: string }>(`
        SELECT count(*) AS count FROM private.domain_events;
      `);

      expect(eventsAfter.rows[0].count).toBe(eventsBefore.rows[0].count);
    });
  });
});
