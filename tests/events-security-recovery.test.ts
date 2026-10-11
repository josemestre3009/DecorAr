// @vitest-environment node
/**
 * DECOR-34: Suite integral de eventos, seguridad, idempotencia y recuperación.
 *
 * Demuestra formalmente:
 * 1. Atomicidad: paquete + outbox (commit_package_change) y budget + processed (process_budget_event).
 * 2. Idempotencia y Desorden: eventos duplicados, desordenados y versiones desconocidas.
 * 3. Seguridad Negativa: A/B/anónimo en RLS, tablas privadas inaccesibles, broadcast privado package:{packageId},
 *    y ausencia de client CRUD / service_role en el browser.
 * 4. Fallo y Recuperación: reclamos de drainers sin duplicar (el lock `FOR UPDATE SKIP LOCKED`
 *    se verifica en la definición SQL; PGlite no reproduce concurrencia multi-conexión),
 *    publicación fallida retenida, transición a failed y reconciliación sin doble total.
 *
 * Ejecución limpia y determinista en memoria mediante @electric-sql/pglite.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { collectImports, isProductionSource, resolveSpecifier } from "../scripts/scan-architecture";

// --- Fixtures canónicas de prueba ---
const USER_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PACKAGE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const PACKAGE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const MODULE_A = "cccccccc-3333-4333-8333-333333333333";
const MODULE_PRICE_COP = 150000;

const supabaseShim = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;

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

let eventSeq = 0;
function createModuleAddedEvent(packageId: string, userId: string, overrides: Record<string, unknown> = {}) {
  eventSeq += 1;
  const seqStr = eventSeq.toString().padStart(4, "0");
  const eventId = `eeeeeeee-${seqStr}-4eee-8eee-eeeeeeeeeeee`;
  const itemId = `dddddddd-${seqStr}-4ddd-8ddd-dddddddddddd`;

  return {
    eventId,
    occurredAt: "2026-10-10T12:00:00.000Z",
    packageId,
    payload: { itemId, moduleId: MODULE_A },
    schemaVersion: 1,
    type: "package.module.added",
    userId,
    ...overrides,
  };
}

describe("DECOR-34: Suite de eventos, seguridad y recuperación", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(supabaseShim);

    const directory = resolve("supabase/migrations");
    const migrationFiles = (await readdir(directory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of migrationFiles) {
      const sql = await readFile(resolve(directory, file), "utf8");
      await db.exec(sql);
    }

    // Seed de usuarios, catálogo y paquetes canónicos
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');

      INSERT INTO public.catalog_modules (
        id, asset_id, version, name, price_cop, area_m2, width_m, height_m, depth_m,
        glb_url, usdz_url, poster_url, status
      ) VALUES (
        '${MODULE_A}', 'fixture-asset', 1, 'Módulo de Prueba DECOR-34', ${MODULE_PRICE_COP},
        1.5, 1.0, 1.0, 1.0, 'https://example.com/mod.glb', 'https://example.com/mod.usdz',
        'https://example.com/mod.webp', 'active'
      );

      INSERT INTO public.packages (id, user_id, version, space_type, capacity_m2) VALUES
        ('${PACKAGE_A}', '${USER_A}', 1, 'salonSocial', 100.00),
        ('${PACKAGE_B}', '${USER_B}', 1, 'casa', 50.00);

      INSERT INTO realtime.messages (topic, extension) VALUES
        ('package:${PACKAGE_A}', 'broadcast'),
        ('package:${PACKAGE_B}', 'broadcast');
    `);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  // Aísla cada prueba: limpia todo el estado mutable y reinicia las versiones,
  // para que ningún caso dependa del orden de ejecución ni de las demás pruebas.
  beforeEach(async () => {
    await db.exec(`
      DELETE FROM private.processed_events;
      DELETE FROM private.domain_events;
      DELETE FROM public.budgets;
      DELETE FROM public.package_items;
      UPDATE public.packages SET version = 1;
    `);
  });

  async function asRole<T extends Record<string, unknown>>(
    role: "anon" | "authenticated" | "service_role",
    userId: string | null,
    topic: string | null,
    sql: string,
    params: unknown[] = [],
  ) {
    await db.exec(`SET ROLE ${role};`);
    if (userId !== null) {
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
    } else {
      await db.exec("SELECT set_config('request.jwt.claim.sub', '', false);");
    }
    if (topic !== null) {
      await db.exec(`SELECT set_config('realtime.topic', '${topic}', false);`);
    } else {
      await db.exec("SELECT set_config('realtime.topic', '', false);");
    }

    try {
      return await db.query<T>(sql, params);
    } finally {
      await db.exec("RESET ROLE");
    }
  }

  // =========================================================================
  // 1. ATOMICIDAD (paquete + outbox; budget + processed)
  // =========================================================================
  describe("1. Atomicidad de transacciones", () => {
    it("commit_package_change muta paquete y escribe outbox domain_events atómicamente", async () => {
      const event = createModuleAddedEvent(PACKAGE_A, USER_A);

      const commitResult = await asRole<{ commit_package_change: number }>(
        "service_role",
        null,
        null,
        "SELECT public.commit_package_change($1, $2, $3) AS commit_package_change",
        [event, 1, "corr-atom-1"],
      );
      expect(commitResult.rows[0].commit_package_change).toBe(2);

      // Verifica que package_items se insertó
      const items = await asRole<{ count: string }>(
        "service_role",
        null,
        null,
        "SELECT count(*)::text AS count FROM public.package_items WHERE package_id = $1",
        [PACKAGE_A],
      );
      expect(items.rows[0].count).toBe("1");

      // Verifica que packages.version avanzó
      const pkg = await asRole<{ version: number }>(
        "service_role",
        null,
        null,
        "SELECT version FROM public.packages WHERE id = $1",
        [PACKAGE_A],
      );
      expect(pkg.rows[0].version).toBe(2);

      // Verifica que private.domain_events guardó el evento en pending
      const outbox = await asRole<{ status: string; attempts: number; correlation_id: string }>(
        "service_role",
        null,
        null,
        "SELECT status, attempts, correlation_id FROM private.domain_events WHERE event_id = $1",
        [event.eventId],
      );
      expect(outbox.rows).toEqual([
        { attempts: 0, correlation_id: "corr-atom-1", status: "pending" },
      ]);
    });

    it("commit_package_change revierte todo si la versión esperada no coincide", async () => {
      const event = createModuleAddedEvent(PACKAGE_A, USER_A);

      // Paquete A está en versión 1, pero le pasamos expectedVersion = 99
      await expect(
        asRole(
          "service_role",
          null,
          null,
          "SELECT public.commit_package_change($1, $2, $3)",
          [event, 99, "corr-atom-conflict"],
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("package.version_conflict") });

      // Ni package_items ni version ni outbox se alteraron
      const outbox = await asRole<{ count: string }>(
        "service_role",
        null,
        null,
        "SELECT count(*)::text AS count FROM private.domain_events WHERE event_id = $1",
        [event.eventId],
      );
      expect(outbox.rows[0].count).toBe("0");

      const pkg = await asRole<{ version: number }>(
        "service_role",
        null,
        null,
        "SELECT version FROM public.packages WHERE id = $1",
        [PACKAGE_A],
      );
      expect(pkg.rows[0].version).toBe(1);
    });

    it("commit_package_change con package.module.removed elimina el ítem y persiste en outbox atómicamente", async () => {
      // Agregamos un item a PACKAGE_B primero
      const addEvent = createModuleAddedEvent(PACKAGE_B, USER_B);
      await asRole(
        "service_role",
        null,
        null,
        "SELECT public.commit_package_change($1, $2, $3)",
        [addEvent, 1, "corr-b-add"],
      );

      const removeEvent = {
        eventId: "eeeeeeee-7777-4eee-8eee-eeeeeeeeeeee",
        occurredAt: "2026-10-10T12:05:00.000Z",
        packageId: PACKAGE_B,
        payload: { itemId: addEvent.payload.itemId, moduleId: addEvent.payload.moduleId },
        schemaVersion: 1,
        type: "package.module.removed",
        userId: USER_B,
      };

      const result = await asRole<{ commit_package_change: number }>(
        "service_role",
        null,
        null,
        "SELECT public.commit_package_change($1, $2, $3) AS commit_package_change",
        [removeEvent, 2, "corr-b-remove"],
      );
      expect(result.rows[0].commit_package_change).toBe(3);

      // Item fue eliminado de package_items
      const remainingItems = await asRole<{ count: string }>(
        "service_role",
        null,
        null,
        "SELECT count(*)::text AS count FROM public.package_items WHERE id = $1",
        [addEvent.payload.itemId],
      );
      expect(remainingItems.rows[0].count).toBe("0");

      // Evento de eliminación está en la outbox
      const outboxRow = await asRole<{ event_type: string; status: string }>(
        "service_role",
        null,
        null,
        "SELECT event_type, status FROM private.domain_events WHERE event_id = $1",
        [removeEvent.eventId],
      );
      expect(outboxRow.rows).toEqual([
        { event_type: "package.module.removed", status: "pending" },
      ]);
    });

    it("commit_package_change con package.module.removed revierte si el ítem no existe", async () => {
      const nonexistentRemove = {
        eventId: "eeeeeeee-8888-4eee-8eee-eeeeeeeeeeee",
        occurredAt: "2026-10-10T12:06:00.000Z",
        packageId: PACKAGE_B,
        payload: {
          itemId: "00000000-0000-4000-8000-000000000000",
          moduleId: MODULE_A,
        },
        schemaVersion: 1,
        type: "package.module.removed",
        userId: USER_B,
      };

      await expect(
        asRole(
          "service_role",
          null,
          null,
          "SELECT public.commit_package_change($1, $2, $3)",
          [nonexistentRemove, 1, "corr-atom-missing-item"],
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("package.item_not_found") });

      // Ningún evento grabado en outbox
      const outboxRow = await asRole<{ count: string }>(
        "service_role",
        null,
        null,
        "SELECT count(*)::text AS count FROM private.domain_events WHERE event_id = $1",
        [nonexistentRemove.eventId],
      );
      expect(outboxRow.rows[0].count).toBe("0");
    });

    it("process_budget_event actualiza budgets y registra processed_events atómicamente", async () => {
      const eventId = "bbbbbbbb-0001-4bbb-8bbb-bbbbbbbbbbbb";
      const result = await asRole<{
        applied: boolean;
        package_id: string;
        package_version: number;
        total_cop: number;
      }>(
        "service_role",
        null,
        null,
        "SELECT * FROM public.process_budget_event($1, $2, $3, $4, $5)",
        ["budget-consumer", eventId, PACKAGE_A, 2, MODULE_PRICE_COP],
      );

      expect(result.rows).toEqual([
        expect.objectContaining({
          applied: true,
          package_id: PACKAGE_A,
          package_version: 2,
          total_cop: MODULE_PRICE_COP,
        }),
      ]);

      // Ambos registros existen en sus respectivas tablas
      const processed = await asRole<{ consumer: string; event_id: string }>(
        "service_role",
        null,
        null,
        "SELECT consumer, event_id FROM private.processed_events WHERE event_id = $1",
        [eventId],
      );
      expect(processed.rows).toEqual([{ consumer: "budget-consumer", event_id: eventId }]);

      const budgetRow = await asRole<{ total_cop: number; package_version: number }>(
        "service_role",
        null,
        null,
        "SELECT total_cop, package_version FROM public.budgets WHERE package_id = $1",
        [PACKAGE_A],
      );
      expect(budgetRow.rows).toEqual([{ package_version: 2, total_cop: MODULE_PRICE_COP }]);
    });

    it("commit_package_change revierte la mutación si la escritura del outbox colisiona (rama unique_violation)", async () => {
      const event = createModuleAddedEvent(PACKAGE_A, USER_A, { eventId: "force-duplicate-evt-001" });

      // Simula la carrera de outbox: la fila no existe todavía (el pre-check pasa)
      // pero el INSERT choca, como si otro drainer insertara el mismo eventId
      // entre el pre-check y el INSERT. PGlite no permite concurrencia real.
      await db.exec(`
        CREATE FUNCTION private.force_event_duplicate() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.event_id = 'force-duplicate-evt-001' THEN
            RAISE EXCEPTION 'simulated race' USING ERRCODE = '23505';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER force_event_duplicate BEFORE INSERT ON private.domain_events
          FOR EACH ROW EXECUTE FUNCTION private.force_event_duplicate();
      `);

      try {
        await expect(
          asRole(
            "service_role",
            null,
            null,
            "SELECT public.commit_package_change($1, $2, $3)",
            [event, 1, "corr-race"],
          ),
        ).rejects.toMatchObject({ message: expect.stringContaining("event.duplicate") });
      } finally {
        await db.exec(`
          DROP TRIGGER IF EXISTS force_event_duplicate ON private.domain_events;
          DROP FUNCTION IF EXISTS private.force_event_duplicate();
        `);
      }

      // La mutación del paquete se revirtió por completo: sin ítem, sin bump de versión, sin outbox
      const items = await asRole<{ count: string }>(
        "service_role",
        null,
        null,
        "SELECT count(*)::text AS count FROM public.package_items WHERE package_id = $1",
        [PACKAGE_A],
      );
      expect(items.rows[0].count).toBe("0");

      const pkg = await asRole<{ version: number }>(
        "service_role",
        null,
        null,
        "SELECT version FROM public.packages WHERE id = $1",
        [PACKAGE_A],
      );
      expect(pkg.rows[0].version).toBe(1);

      const outbox = await asRole<{ count: string }>(
        "service_role",
        null,
        null,
        "SELECT count(*)::text AS count FROM private.domain_events WHERE event_id = $1",
        [event.eventId],
      );
      expect(outbox.rows[0].count).toBe("0");
    });
  });

  // =========================================================================
  // 2. IDEMPOTENCIA, DESORDEN Y VERSIONES DESCONOCIDAS
  // =========================================================================
  describe("2. Idempotencia y tolerancia al desorden", () => {
    it("commit_package_change rechaza un eventId duplicado antes de mutar el paquete", async () => {
      const event = createModuleAddedEvent(PACKAGE_A, USER_A);
      // Primer commit exitoso: versión 1 -> 2
      await asRole(
        "service_role",
        null,
        null,
        "SELECT public.commit_package_change($1, $2, $3)",
        [event, 1, "corr-dup-1"],
      );

      // Reintento con el mismo eventId
      await expect(
        asRole(
          "service_role",
          null,
          null,
          "SELECT public.commit_package_change($1, $2, $3)",
          [event, 2, "corr-dup-2"],
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("event.duplicate") });

      // La versión sigue en 2 y no se agregaron ítems duplicados
      const pkg = await asRole<{ version: number }>(
        "service_role",
        null,
        null,
        "SELECT version FROM public.packages WHERE id = $1",
        [PACKAGE_A],
      );
      expect(pkg.rows[0].version).toBe(2);
    });

    it("process_budget_event ignora eventId repetido y no altera el presupuesto (applied=false)", async () => {
      const eventId = "dup-budget-evt-001";
      // Primera aplicación
      const first = await asRole<{ applied: boolean }>(
        "service_role",
        null,
        null,
        "SELECT * FROM public.process_budget_event($1, $2, $3, $4, $5)",
        ["budget-consumer", eventId, PACKAGE_A, 3, 300000],
      );
      expect(first.rows[0].applied).toBe(true);

      // Segundo procesamiento con el mismo eventId
      const second = await asRole<{ applied: boolean; total_cop: number; package_version: number }>(
        "service_role",
        null,
        null,
        "SELECT * FROM public.process_budget_event($1, $2, $3, $4, $5)",
        ["budget-consumer", eventId, PACKAGE_A, 3, 999999], // Intento de inflar total
      );

      expect(second.rows[0].applied).toBe(false);
      expect(second.rows[0].total_cop).toBe(300000);
      expect(second.rows[0].package_version).toBe(3);

      const budgetRow = await asRole<{ total_cop: number }>(
        "service_role",
        null,
        null,
        "SELECT total_cop FROM public.budgets WHERE package_id = $1",
        [PACKAGE_A],
      );
      expect(budgetRow.rows[0].total_cop).toBe(300000);
    });

    it("process_budget_event ante un evento desordenado (versión vieja) no sobrescribe el total", async () => {
      // Precondición: el presupuesto ya está en versión 3 con total 300000
      await asRole(
        "service_role",
        null,
        null,
        "SELECT * FROM public.process_budget_event($1, $2, $3, $4, $5)",
        ["budget-consumer", "seed-high-version", PACKAGE_A, 3, 300000],
      );

      const outOfOrderEventId = "out-of-order-evt-001";

      const outOfOrder = await asRole<{ applied: boolean; total_cop: number; package_version: number }>(
        "service_role",
        null,
        null,
        "SELECT * FROM public.process_budget_event($1, $2, $3, $4, $5)",
        ["budget-consumer", outOfOrderEventId, PACKAGE_A, 1, 50000], // Versión 1 cuando ya estamos en 3
      );

      expect(outOfOrder.rows[0].applied).toBe(false);
      expect(outOfOrder.rows[0].total_cop).toBe(300000);
      expect(outOfOrder.rows[0].package_version).toBe(3);

      // Queda guardado en processed_events para evitar reintentos como si fuera nuevo
      const processed = await asRole<{ count: string }>(
        "service_role",
        null,
        null,
        "SELECT count(*)::text AS count FROM private.processed_events WHERE event_id = $1",
        [outOfOrderEventId],
      );
      expect(processed.rows[0].count).toBe("1");
    });

    it("commit_package_change rechaza un schemaVersion desconocido sin mutar nada", async () => {
      const unknownVersionEvent = createModuleAddedEvent(PACKAGE_A, USER_A, {
        eventId: "unknown-schema-ver-001",
        schemaVersion: 99,
      });

      const before = await asRole<{ version: number }>(
        "service_role",
        null,
        null,
        "SELECT version FROM public.packages WHERE id = $1",
        [PACKAGE_A],
      );

      await expect(
        asRole(
          "service_role",
          null,
          null,
          "SELECT public.commit_package_change($1, $2, $3)",
          [unknownVersionEvent, null, "corr-unknown-version"],
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("event.unsupported_version") });

      // Ni outbox ni versión del paquete se alteraron
      const outbox = await asRole<{ count: string }>(
        "service_role",
        null,
        null,
        "SELECT count(*)::text AS count FROM private.domain_events WHERE event_id = $1",
        [unknownVersionEvent.eventId],
      );
      expect(outbox.rows[0].count).toBe("0");

      const after = await asRole<{ version: number }>(
        "service_role",
        null,
        null,
        "SELECT version FROM public.packages WHERE id = $1",
        [PACKAGE_A],
      );
      expect(after.rows[0].version).toBe(before.rows[0].version);
    });
  });

  // =========================================================================
  // 3. SEGURIDAD Y AUTORIZACIÓN NEGATIVA
  // =========================================================================
  describe("3. Seguridad y autorización negativa", () => {
    it("Usuario A ve únicamente sus paquetes e ítems, Usuario B ve solo los suyos", async () => {
      const packagesA = await asRole<{ id: string }>(
        "authenticated",
        USER_A,
        null,
        "SELECT id FROM public.packages ORDER BY id",
      );
      expect(packagesA.rows).toEqual([{ id: PACKAGE_A }]);

      const packagesB = await asRole<{ id: string }>(
        "authenticated",
        USER_B,
        null,
        "SELECT id FROM public.packages ORDER BY id",
      );
      expect(packagesB.rows).toEqual([{ id: PACKAGE_B }]);

      // Usuario B no ve el paquete de A ni sus items
      const bQueryingA = await asRole<{ id: string }>(
        "authenticated",
        USER_B,
        null,
        "SELECT id FROM public.packages WHERE id = $1",
        [PACKAGE_A],
      );
      expect(bQueryingA.rows).toEqual([]);

      const itemsASeenByB = await asRole<{ id: string }>(
        "authenticated",
        USER_B,
        null,
        "SELECT id FROM public.package_items WHERE package_id = $1",
        [PACKAGE_A],
      );
      expect(itemsASeenByB.rows).toEqual([]);
    });

    it("Usuario B no ve el presupuesto de Usuario A; Usuario A sí lee su presupuesto", async () => {
      // Precondición: existe un presupuesto para PACKAGE_A (creado como service_role)
      await asRole(
        "service_role",
        null,
        null,
        "SELECT * FROM public.process_budget_event($1, $2, $3, $4, $5)",
        ["budget-consumer", "seed-budget-a", PACKAGE_A, 1, 300000],
      );

      const budgetA = await asRole<{ package_id: string; total_cop: number }>(
        "authenticated",
        USER_A,
        null,
        "SELECT package_id, total_cop FROM public.budgets WHERE package_id = $1",
        [PACKAGE_A],
      );
      expect(budgetA.rows).toEqual([{ package_id: PACKAGE_A, total_cop: 300000 }]);

      const budgetASeenByB = await asRole<{ package_id: string }>(
        "authenticated",
        USER_B,
        null,
        "SELECT package_id FROM public.budgets WHERE package_id = $1",
        [PACKAGE_A],
      );
      expect(budgetASeenByB.rows).toEqual([]);
    });

    it("Rol anónimo es rechazado con error 42501 sobre paquetes y presupuestos", async () => {
      await expect(
        asRole("anon", null, null, "SELECT id FROM public.packages"),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole("anon", null, null, "SELECT * FROM public.budgets"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("Escritura directa denegada a usuarios autenticados y anónimos en tablas de negocio", async () => {
      // Direct UPDATE on packages
      await expect(
        asRole("authenticated", USER_A, null, "UPDATE public.packages SET version = 999 WHERE id = $1", [PACKAGE_A]),
      ).rejects.toMatchObject({ code: "42501" });

      // Direct INSERT on budgets
      await expect(
        asRole(
          "authenticated",
          USER_A,
          null,
          "INSERT INTO public.budgets (package_id, total_cop, package_version) VALUES ($1, 999, 1)",
          [PACKAGE_A],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("Acceso totalmente denegado al esquema private y tablas domain_events/processed_events", async () => {
      await expect(
        asRole("authenticated", USER_A, null, "SELECT * FROM private.domain_events"),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole("anon", null, null, "SELECT * FROM private.domain_events"),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole("authenticated", USER_A, null, "SELECT * FROM private.processed_events"),
      ).rejects.toMatchObject({ code: "42501" });

      await expect(
        asRole("anon", null, null, "SELECT * FROM private.processed_events"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("RPCs internas restringidas exclusivamente a service_role (denegadas a anon y authenticated)", async () => {
      const rpcPrivileges = await db.query<{
        commit_rpc: boolean;
        claim_rpc: boolean;
        budget_rpc: boolean;
        reconcile_rpc: boolean;
      }>(`
        SELECT
          has_function_privilege('authenticated', 'public.commit_package_change(jsonb,integer,text)', 'EXECUTE') AS commit_rpc,
          has_function_privilege('authenticated', 'public.claim_initial_domain_events(integer)', 'EXECUTE') AS claim_rpc,
          has_function_privilege('authenticated', 'public.process_budget_event(text,text,uuid,integer,bigint)', 'EXECUTE') AS budget_rpc,
          has_function_privilege('authenticated', 'public.reconcile_budget(uuid,integer,bigint)', 'EXECUTE') AS reconcile_rpc
      `);

      expect(rpcPrivileges.rows).toEqual([
        { budget_rpc: false, claim_rpc: false, commit_rpc: false, reconcile_rpc: false },
      ]);

      await expect(
        asRole("authenticated", USER_A, null, "SELECT * FROM public.process_budget_event('b', 'e', $1, 1, 1)", [PACKAGE_A]),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("Canal Broadcast privado package:{packageId}: solo el dueño puede escuchar; clientes no pueden publicar", async () => {
      // Dueño A puede leer realtime.messages de su propio canal
      const subA = await asRole<{ topic: string }>(
        "authenticated",
        USER_A,
        `package:${PACKAGE_A}`,
        "SELECT topic FROM realtime.messages WHERE topic = $1",
        [`package:${PACKAGE_A}`],
      );
      expect(subA.rows.length).toBeGreaterThan(0);

      // Usuario B no puede leer los mensajes del canal de A
      const subB = await asRole<{ topic: string }>(
        "authenticated",
        USER_B,
        `package:${PACKAGE_A}`,
        "SELECT topic FROM realtime.messages WHERE topic = $1",
        [`package:${PACKAGE_A}`],
      );
      expect(subB.rows).toEqual([]);

      // Ningún cliente (incluso el dueño) puede insertar mensajes en realtime.messages
      await expect(
        asRole(
          "authenticated",
          USER_A,
          `package:${PACKAGE_A}`,
          "INSERT INTO realtime.messages (topic, extension) VALUES ($1, 'broadcast')",
          [`package:${PACKAGE_A}`],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("Frontera del navegador: ningún módulo client importa el cliente admin ni SUPABASE_SERVICE_ROLE_KEY", async () => {
      const ADMIN_MODULE = "src/infrastructure/supabase/admin.ts";
      const BROWSER_FACTORY = "src/infrastructure/supabase/browser.ts";

      async function walk(directory: string): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true });
        const nested = await Promise.all(
          entries.map((entry) => {
            const full = join(directory, entry.name);
            if (entry.isDirectory()) return walk(full);
            return Promise.resolve(isProductionSource(entry.name) ? [full] : []);
          }),
        );
        return nested.flat();
      }

      function resolveCandidate(base: string): string | null {
        for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
          if (/\.tsx?$/.test(candidate) && existsSync(resolve(candidate))) return candidate;
        }
        return null;
      }

      async function buildClientGraph(entry: string): Promise<Set<string>> {
        const seen = new Set<string>();
        const queue = [entry];

        while (queue.length > 0) {
          const file = queue.pop()!;
          if (seen.has(file)) continue;
          seen.add(file);

          const content = await readFile(resolve(file), "utf8");
          for (const { specifier } of collectImports(content, file)) {
            const resolved = resolveSpecifier(file, specifier);
            const found = resolved ? resolveCandidate(resolved) : null;
            if (found) queue.push(found);
          }
        }
        return seen;
      }

      const files = (await walk(resolve("src"))).map((f) => relative(process.cwd(), f).replace(/\\/g, "/"));
      const clientEntries = [BROWSER_FACTORY];

      for (const file of files) {
        const code = await readFile(resolve(file), "utf8");
        if (/^\s*["']use client["']/.test(code)) clientEntries.push(file);
      }

      for (const entry of clientEntries) {
        const graph = await buildClientGraph(entry);
        expect([...graph]).not.toContain(ADMIN_MODULE);

        for (const reachableFile of graph) {
          const code = await readFile(resolve(reachableFile), "utf8");
          expect(code).not.toContain("createAdminClient");
          expect(code).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
        }
      }
    });
  });

  // =========================================================================
  // 4. CONCURRENCIA, FALLO Y RECUPERACIÓN
  // =========================================================================
  describe("4. Concurrencia, fallo y recuperación", () => {
    it("Reclamos de claim_initial_domain_events no duplican eventos y conservan el lock SQL", async () => {
      // PGlite expone una única conexión y serializa las consultas, así que no
      // reproduce concurrencia real entre conexiones. Se verifica el reparto
      // sin solapamiento de dos reclamos sucesivos y, estructuralmente, que la
      // definición SQL conserva el locking que lo garantiza en producción.
      const def = await db.query<{ body: string }>(
        "SELECT prosrc AS body FROM pg_catalog.pg_proc WHERE proname = 'claim_initial_domain_events'",
      );
      expect(def.rows[0].body).toMatch(/FOR UPDATE\s+SKIP LOCKED/i);

      // Insertamos 6 eventos pending en private.domain_events
      for (let i = 0; i < 6; i++) {
        const evtId = `drainer-test-${i}-${Date.now()}`;
        await db.exec(`
          INSERT INTO private.domain_events (event_id, package_id, user_id, event_type, occurred_at, event, status, attempts)
          VALUES ('${evtId}', '${PACKAGE_A}', '${USER_A}', 'package.module.added', now(), '{"eventId": "${evtId}"}', 'pending', 0);
        `);
      }

      // Dos drainers reclamando el mismo lote (claim_initial_domain_events(3) cada uno)
      const drainer1 = await asRole<{ event_id: string }>(
        "service_role",
        null,
        null,
        "SELECT event_id FROM public.claim_initial_domain_events(3)",
      );
      const drainer2 = await asRole<{ event_id: string }>(
        "service_role",
        null,
        null,
        "SELECT event_id FROM public.claim_initial_domain_events(3)",
      );

      const ids1 = drainer1.rows.map((r) => r.event_id);
      const ids2 = drainer2.rows.map((r) => r.event_id);

      // Reparto sin solapamiento: cada evento reclamado una sola vez
      expect(ids1.length).toBeGreaterThan(0);
      expect(ids2.length).toBeGreaterThan(0);
      expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);

      // Todos los eventos reclamados avanzaron su attempts a 1
      for (const id of [...ids1, ...ids2]) {
        const row = await asRole<{ attempts: number; status: string }>(
          "service_role",
          null,
          null,
          "SELECT attempts, status FROM private.domain_events WHERE event_id = $1",
          [id],
        );
        expect(row.rows[0].attempts).toBe(1);
        expect(row.rows[0].status).toBe("pending");
      }
    });

    it("Fallo en publicación mantiene el evento en pending con attempts incrementado y error registrado", async () => {
      const evtId = `failing-publish-${Date.now()}`;
      await db.exec(`
        INSERT INTO private.domain_events (event_id, package_id, user_id, event_type, occurred_at, event, status, attempts)
        VALUES ('${evtId}', '${PACKAGE_A}', '${USER_A}', 'package.module.added', now(), '{"eventId": "${evtId}"}', 'pending', 1);
      `);

      // Se registra fallo de publicación
      await asRole(
        "service_role",
        null,
        null,
        "SELECT public.record_domain_event_failure($1, $2)",
        [evtId, "Realtime channel connection timeout"],
      );

      const row = await asRole<{ status: string; attempts: number; last_error: string }>(
        "service_role",
        null,
        null,
        "SELECT status, attempts, last_error FROM private.domain_events WHERE event_id = $1",
        [evtId],
      );
      expect(row.rows).toEqual([
        {
          attempts: 1,
          last_error: "Realtime channel connection timeout",
          status: "pending",
        },
      ]);
    });

    it("Reintentos acotados: tras agotar 3 reintentos, el evento transiciona a failed y deja de ser reintentable", async () => {
      const exhaustedEvtId = `exhausted-evt-${Date.now()}`;
      await db.exec(`
        INSERT INTO private.domain_events (event_id, package_id, user_id, event_type, occurred_at, event, status, attempts)
        VALUES ('${exhaustedEvtId}', '${PACKAGE_A}', '${USER_A}', 'package.module.added', now(), '{"eventId": "${exhaustedEvtId}"}', 'pending', 3);
      `);

      // Tercer reintento falla: se marca failed
      const marked = await asRole<{ mark_domain_event_failed: boolean }>(
        "service_role",
        null,
        null,
        "SELECT public.mark_domain_event_failed($1, $2) AS mark_domain_event_failed",
        [exhaustedEvtId, "Exhausted 3 retry attempts"],
      );
      expect(marked.rows[0].mark_domain_event_failed).toBe(true);

      const finalRow = await asRole<{ status: string; last_error: string }>(
        "service_role",
        null,
        null,
        "SELECT status, last_error FROM private.domain_events WHERE event_id = $1",
        [exhaustedEvtId],
      );
      expect(finalRow.rows).toEqual([
        {
          last_error: "Exhausted 3 retry attempts",
          status: "failed",
        },
      ]);

      // No aparece en list_retryable_domain_events
      const retryables = await asRole<{ event_id: string }>(
        "service_role",
        null,
        null,
        "SELECT event_id FROM public.list_retryable_domain_events(100) WHERE event_id = $1",
        [exhaustedEvtId],
      );
      expect(retryables.rows).toEqual([]);
    });

    it("Reconciliación de presupuesto (reconcile_budget) detecta y corrige drift sin doble total", async () => {
      // Supongamos que el presupuesto de PACKAGE_B quedó desalineado (p. ej. en 0 o desactualizado)
      const initialReconcile = await asRole<{
        corrected: boolean;
        package_id: string;
        package_version: number;
        total_cop: number;
      }>(
        "service_role",
        null,
        null,
        "SELECT * FROM public.reconcile_budget($1, $2, $3)",
        [PACKAGE_B, 1, 450000],
      );

      expect(initialReconcile.rows).toEqual([
        expect.objectContaining({
          corrected: true,
          package_id: PACKAGE_B,
          package_version: 1,
          total_cop: 450000,
        }),
      ]);

      // Segunda llamada con los mismos datos: no corrige de más (idempotente)
      const secondReconcile = await asRole<{ corrected: boolean; total_cop: number }>(
        "service_role",
        null,
        null,
        "SELECT * FROM public.reconcile_budget($1, $2, $3)",
        [PACKAGE_B, 1, 450000],
      );
      expect(secondReconcile.rows[0].corrected).toBe(false);
      expect(secondReconcile.rows[0].total_cop).toBe(450000);

      // Reconciliación con corrección real a la misma versión
      const driftedCorrection = await asRole<{ corrected: boolean; total_cop: number }>(
        "service_role",
        null,
        null,
        "SELECT * FROM public.reconcile_budget($1, $2, $3)",
        [PACKAGE_B, 1, 600000],
      );
      expect(driftedCorrection.rows[0].corrected).toBe(true);
      expect(driftedCorrection.rows[0].total_cop).toBe(600000);

      const finalBudget = await asRole<{ total_cop: number }>(
        "service_role",
        null,
        null,
        "SELECT total_cop FROM public.budgets WHERE package_id = $1",
        [PACKAGE_B],
      );
      expect(finalBudget.rows[0].total_cop).toBe(600000);
    });
  });
});
