// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { calculateQuote } from "../../src/modules/quotes/domain/quote-totals";
import type { QuoteLineSnapshot } from "../../src/modules/quotes/domain/quote";

/**
 * DECOR-50: cotizaciones versionadas con precios congelados.
 *
 * Aplica todas las migraciones en PostgreSQL embebido (PGlite) y prueba:
 * numeración por dueño, instantánea inmutable frente a cambios de paquete y
 * catálogo, versiones independientes, transiciones de estado, verificación
 * de la instantánea contra el paquete bloqueado, RLS y privilegios.
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULE_SILLA = "11111111-1111-4111-8111-111111111111";
const MODULE_ARCO = "22222222-2222-4222-8222-222222222222";

const MIGRATIONS_DIR = resolve("supabase/migrations");

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

async function applyMigrations(db: PGlite): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(resolve(MIGRATIONS_DIR, file), "utf8"));
  }
}

async function asRole<T>(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
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

type QuoteRow = {
  id: string;
  quote_number: number;
  version: number;
  status: string;
  package_id: string | null;
  source_package_version: number;
  client_name: string | null;
  event_name: string;
  subtotal_cop: number;
  discount_cop: number;
  tax_cop: number;
  total_cop: number;
  deposit_cop: number;
  quote_lines: {
    position: number;
    module_id: string;
    name: string;
    quantity: number;
    unit_price_cop: number;
    line_total_cop: number;
  }[];
};

const TERMS = { depositRateBp: 5_000, discountRateBp: 1_000, taxRateBp: 1_900 };

/** Construye los argumentos del RPC como lo hace la aplicación: dominio puro. */
function payload(
  snapshot: QuoteLineSnapshot[],
  overrides: Record<string, unknown> = {},
): { quote: Record<string, unknown>; lines: readonly unknown[] } {
  const calculation = calculateQuote(snapshot, TERMS);
  if (!calculation.ok) throw calculation.error;
  const { totals } = calculation.value;

  return {
    lines: calculation.value.lines,
    quote: {
      conditions: "50 % al firmar",
      depositCop: totals.depositCop,
      discountCop: totals.discountCop,
      subtotalCop: totals.subtotalCop,
      taxCop: totals.taxCop,
      totalCop: totals.totalCop,
      validUntil: "2026-12-31",
      ...TERMS,
      ...overrides,
    },
  };
}

describe("DECOR-50: cotizaciones versionadas", () => {
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
      ('${MODULE_SILLA}', 'silla-test', 1, 'Silla', 20000, 1, 1, 1, 1,
       'https://example.com/s.glb', 'https://example.com/s.usdz', null, 'active'),
      ('${MODULE_ARCO}', 'arco-test', 1, 'Arco floral', 150000, 2, 2, 2, 1,
       'https://example.com/a.glb', 'https://example.com/a.usdz', null, 'active');
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  /** Evento "Boda Ana": 10 sillas y 2 arcos. */
  async function seedEvent(userId = USER_A, sillas = 10, arcos = 2) {
    const packageId = randomUUID();
    await db.query(
      `INSERT INTO public.packages (id, user_id, name, client_name, event_date, venue, event_type, version)
       VALUES ($1, $2, 'Boda Ana', 'Ana Pérez', '2026-12-20', 'Club', 'boda', 1)`,
      [packageId, userId],
    );
    for (let i = 0; i < sillas; i += 1) {
      await db.query(
        `INSERT INTO public.package_items (id, package_id, module_id) VALUES ($1, $2, $3)`,
        [randomUUID(), packageId, MODULE_SILLA],
      );
    }
    for (let i = 0; i < arcos; i += 1) {
      await db.query(
        `INSERT INTO public.package_items (id, package_id, module_id) VALUES ($1, $2, $3)`,
        [randomUUID(), packageId, MODULE_ARCO],
      );
    }
    return packageId;
  }

  const snapshotOf = (sillas = 10, arcos = 2, precioSilla = 20_000): QuoteLineSnapshot[] => [
    { moduleId: MODULE_ARCO, name: "Arco floral", quantity: arcos, unitPriceCop: 150_000 },
    { moduleId: MODULE_SILLA, name: "Silla", quantity: sillas, unitPriceCop: precioSilla },
  ];

  // DECOR-55: cada llamada es una intención nueva (clave y huella propias).
  async function createQuote(
    packageId: string,
    owner = USER_A,
    data = payload(snapshotOf()),
    expectedVersion = 1,
  ): Promise<QuoteRow> {
    const result = await db.query<{ result: QuoteRow }>(
      `SELECT public.create_quote($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7) AS result`,
      [owner, packageId, expectedVersion, JSON.stringify(data.quote), JSON.stringify(data.lines), randomUUID(), randomUUID()],
    );
    return result.rows[0].result;
  }

  /** Por defecto envía como `expectedVersion` la versión más nueva del número (DECOR-55). */
  async function createVersion(
    quoteId: string,
    data = payload(snapshotOf()),
    expectedVersion = 1,
    owner = USER_A,
  ): Promise<QuoteRow> {
    const latest = await db.query<{ version: number | null }>(
      `SELECT max(q.version) AS version FROM public.quotes q
        WHERE (q.owner_id, q.quote_number) = (SELECT owner_id, quote_number FROM public.quotes WHERE id = $1)`,
      [quoteId],
    );
    const result = await db.query<{ result: QuoteRow }>(
      `SELECT public.create_quote_version($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8) AS result`,
      [
        owner,
        quoteId,
        expectedVersion,
        JSON.stringify(data.quote),
        JSON.stringify(data.lines),
        latest.rows[0]?.version ?? 1,
        randomUUID(),
        randomUUID(),
      ],
    );
    return result.rows[0].result;
  }

  async function readQuote(quoteId: string): Promise<QuoteRow> {
    const result = await db.query<{ result: QuoteRow }>(`SELECT private.quote_json($1) AS result`, [quoteId]);
    return result.rows[0].result;
  }

  it("crea la versión 1 con datos del evento, líneas y totales congelados", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);

    expect(quote).toMatchObject({
      client_name: "Ana Pérez",
      deposit_cop: 267_750,
      discount_cop: 50_000,
      event_name: "Boda Ana",
      package_id: packageId,
      source_package_version: 1,
      status: "draft",
      subtotal_cop: 500_000,
      tax_cop: 85_500,
      total_cop: 535_500,
      version: 1,
    });
    expect(quote.quote_lines).toEqual([
      expect.objectContaining({ line_total_cop: 300_000, name: "Arco floral", position: 1, quantity: 2 }),
      expect.objectContaining({ line_total_cop: 200_000, name: "Silla", position: 2, quantity: 10 }),
    ]);
  });

  it("numera por dueño sin repetir: A obtiene 1, 2…; B empieza en 1", async () => {
    const otherA = await seedEvent(USER_A);
    const firstB = await seedEvent(USER_B);

    const a1 = await createQuote(otherA);
    const a2 = await createQuote(otherA);
    const b1 = await createQuote(firstB, USER_B);

    expect(a2.quote_number).toBe(a1.quote_number + 1);
    expect(b1.quote_number).toBe(1);
  });

  it("conserva valores históricos si cambian el catálogo o el paquete", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    const before = await readQuote(quote.id);

    await db.exec(`UPDATE public.catalog_modules SET price_cop = 99000, name = 'Silla Tiffany'
                   WHERE id = '${MODULE_SILLA}'`);
    await db.query(`DELETE FROM public.package_items WHERE package_id = $1 AND module_id = $2`, [
      packageId,
      MODULE_ARCO,
    ]);
    await db.query(`UPDATE public.packages SET name = 'Otro nombre', version = 2 WHERE id = $1`, [packageId]);

    expect(await readQuote(quote.id)).toEqual(before);

    await db.exec(`UPDATE public.catalog_modules SET price_cop = 20000, name = 'Silla'
                   WHERE id = '${MODULE_SILLA}'`);
  });

  it("una versión nueva conserva el número y no altera la anterior", async () => {
    const packageId = await seedEvent();
    const v1 = await createQuote(packageId);
    const v1Before = await readQuote(v1.id);

    // El paquete cambia: 5 sillas más (versión 2) y la silla sube de precio.
    for (let i = 0; i < 5; i += 1) {
      await db.query(`INSERT INTO public.package_items (id, package_id, module_id) VALUES ($1, $2, $3)`, [
        randomUUID(),
        packageId,
        MODULE_SILLA,
      ]);
    }
    await db.query(`UPDATE public.packages SET version = 2 WHERE id = $1`, [packageId]);
    await db.exec(`UPDATE public.catalog_modules SET price_cop = 25000 WHERE id = '${MODULE_SILLA}'`);

    const v2 = await createVersion(v1.id, payload(snapshotOf(15, 2, 25_000)), 2);

    expect(v2.quote_number).toBe(v1.quote_number);
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);
    expect(v2.subtotal_cop).toBe(15 * 25_000 + 2 * 150_000);
    expect(v2.source_package_version).toBe(2);
    expect(await readQuote(v1.id)).toEqual(v1Before);

    // Crear la v3 desde la v1 sigue la numeración de versiones.
    const v3 = await createVersion(v1.id, payload(snapshotOf(15, 2, 25_000)), 2);
    expect(v3.version).toBe(3);

    await db.exec(`UPDATE public.catalog_modules SET price_cop = 20000 WHERE id = '${MODULE_SILLA}'`);
  });

  describe("inmutabilidad y estados", () => {
    it("rechaza cambiar montos, términos o datos congelados", async () => {
      const quote = await createQuote(await seedEvent());

      await expect(db.query(`UPDATE public.quotes SET total_cop = 1 WHERE id = $1`, [quote.id])).rejects.toThrow(
        "quote.immutable",
      );
      await expect(
        db.query(`UPDATE public.quotes SET client_name = 'Otro' WHERE id = $1`, [quote.id]),
      ).rejects.toThrow("quote.immutable");
      await expect(
        db.query(`UPDATE public.quote_lines SET unit_price_cop = 1 WHERE quote_id = $1`, [quote.id]),
      ).rejects.toThrow("quote.immutable");
    });

    it("sigue las transiciones borrador → enviada → aceptada", async () => {
      const quote = await createQuote(await seedEvent());
      const change = (status: string, expected: string) =>
        db.query<{ result: QuoteRow }>(`SELECT public.change_quote_status($1, $2, $3, $4) AS result`, [
          USER_A,
          quote.id,
          status,
          expected,
        ]);

      await expect(change("accepted", "draft")).rejects.toThrow("quote.invalid_status_transition");
      expect((await change("sent", "draft")).rows[0].result.status).toBe("sent");
      expect((await change("accepted", "sent")).rows[0].result.status).toBe("accepted");
      await expect(change("draft", "accepted")).rejects.toThrow("quote.invalid_status_transition");
      await expect(change("cancelled", "accepted")).rejects.toThrow("quote.invalid_status");
    });

    it("permite vencer un borrador o una enviada, y vencida es final", async () => {
      const quote = await createQuote(await seedEvent());
      await db.query(`SELECT public.change_quote_status($1, $2, 'expired', 'draft')`, [USER_A, quote.id]);
      await expect(
        db.query(`SELECT public.change_quote_status($1, $2, 'sent', 'expired')`, [USER_A, quote.id]),
      ).rejects.toThrow("quote.invalid_status_transition");
    });

    it("si se borra el paquete, la cotización se conserva sin referencia", async () => {
      const packageId = await seedEvent();
      const quote = await createQuote(packageId);

      await db.query(`DELETE FROM public.packages WHERE id = $1`, [packageId]);

      const kept = await readQuote(quote.id);
      expect(kept.package_id).toBeNull();
      expect(kept.total_cop).toBe(535_500);
      await expect(createVersion(quote.id)).rejects.toThrow("quote.package_missing");
    });
  });

  describe("rechaza valores inválidos y desfasados", () => {
    it("versión del paquete distinta a la leída", async () => {
      const packageId = await seedEvent();
      await expect(createQuote(packageId, USER_A, payload(snapshotOf()), 7)).rejects.toThrow(
        "quote.package_version_conflict",
      );
    });

    it.each([
      ["precio distinto al catálogo", snapshotOf(10, 2, 1_000)],
      ["cantidad distinta al paquete", snapshotOf(9, 2)],
      ["falta un concepto", snapshotOf().slice(0, 1)],
    ])("instantánea que no coincide: %s", async (_label, snapshot) => {
      const packageId = await seedEvent();
      await expect(createQuote(packageId, USER_A, payload(snapshot))).rejects.toThrow("quote.snapshot_mismatch");
    });

    it("calcula tasas sin desbordar el producto intermedio de bigint", async () => {
      const amount = Number.MAX_SAFE_INTEGER;
      const result = await db.query<{ rounded: string }>(
        `SELECT trunc(($1::bigint::numeric * $2::integer + 5000) / 10000)::bigint::text AS rounded`,
        [amount, 10_000],
      );

      expect(result.rows[0].rounded).toBe(amount.toString());
    });

    it("subtotal que no es la suma de las líneas", async () => {
      const packageId = await seedEvent();
      await expect(
        createQuote(packageId, USER_A, payload(snapshotOf(), { subtotalCop: 1 })),
      ).rejects.toThrow("quote.invalid_totals");
    });

    it("total que no cuadra con subtotal, descuento e impuesto", async () => {
      const packageId = await seedEvent();
      await expect(createQuote(packageId, USER_A, payload(snapshotOf(), { depositCop: 0, totalCop: 1 }))).rejects.toThrow(
        "quote.invalid_totals",
      );
    });

    it.each([
      ["descuento", { discountCop: 0, taxCop: 101_745, totalCop: 636_745, depositCop: 318_373 }],
      ["impuesto", { taxCop: 0, totalCop: 481_500, depositCop: 240_750 }],
      ["anticipo", { depositCop: 0 }],
    ])("montos derivados que no coinciden con la tasa: %s", async (_label, totals) => {
      const packageId = await seedEvent();
      await expect(createQuote(packageId, USER_A, payload(snapshotOf(), totals))).rejects.toThrow(
        "quote.invalid_totals",
      );
    });

    it("tasa fuera de 0 % a 100 %", async () => {
      const packageId = await seedEvent();
      await expect(
        createQuote(packageId, USER_A, payload(snapshotOf(), { taxRateBp: 10_001 })),
      ).rejects.toThrow("chk_quotes_rates");
    });

    it("paquete vacío", async () => {
      const packageId = await seedEvent(USER_A, 0, 0);
      await expect(createQuote(packageId)).rejects.toThrow("quote.empty_package");
    });

    it("no consume número si la creación falla", async () => {
      const packageId = await seedEvent(USER_B);
      const before = await createQuote(packageId, USER_B);
      await expect(createQuote(packageId, USER_B, payload(snapshotOf()), 9)).rejects.toThrow();
      const after = await createQuote(packageId, USER_B);
      expect(after.quote_number).toBe(before.quote_number + 1);
    });
  });

  describe("acceso de otro usuario", () => {
    it("B no puede cotizar el paquete de A ni versionar o cambiar su cotización", async () => {
      const packageId = await seedEvent(USER_A);
      const quote = await createQuote(packageId);

      await expect(createQuote(packageId, USER_B)).rejects.toThrow("package.not_found");
      await expect(createVersion(quote.id, payload(snapshotOf()), 1, USER_B)).rejects.toThrow("quote.not_found");
      await expect(
        db.query(`SELECT public.change_quote_status($1, $2, 'sent', 'draft')`, [USER_B, quote.id]),
      ).rejects.toThrow("quote.not_found");
    });

    it("RLS: cada dueño lee solo sus cotizaciones y líneas; anon no lee nada", async () => {
      const quote = await createQuote(await seedEvent(USER_A));

      const ownQuotes = await asRole(db, "authenticated", USER_A, () =>
        db.query(`SELECT id FROM public.quotes WHERE id = $1`, [quote.id]),
      );
      const ownLines = await asRole(db, "authenticated", USER_A, () =>
        db.query(`SELECT id FROM public.quote_lines WHERE quote_id = $1`, [quote.id]),
      );
      const foreignQuotes = await asRole(db, "authenticated", USER_B, () =>
        db.query(`SELECT id FROM public.quotes WHERE owner_id = $1`, [USER_A]),
      );
      const foreignLines = await asRole(db, "authenticated", USER_B, () =>
        db.query(`SELECT id FROM public.quote_lines WHERE quote_id = $1`, [quote.id]),
      );

      expect(ownQuotes.rows).toHaveLength(1);
      expect(ownLines.rows).toHaveLength(2);
      expect(foreignQuotes.rows).toHaveLength(0);
      expect(foreignLines.rows).toHaveLength(0);
      await expect(
        asRole(db, "anon", null, () => db.query(`SELECT id FROM public.quotes`)),
      ).rejects.toThrow(/permission denied/);
    });

    it("authenticated no escribe directo ni ejecuta los RPC", async () => {
      const quote = await createQuote(await seedEvent(USER_A));

      for (const sql of [
        `UPDATE public.quotes SET status = 'sent' WHERE id = '${quote.id}'`,
        `DELETE FROM public.quotes WHERE id = '${quote.id}'`,
        `DELETE FROM public.quote_lines WHERE quote_id = '${quote.id}'`,
        `SELECT public.change_quote_status('${USER_A}', '${quote.id}', 'sent', 'draft')`,
        `SELECT public.create_quote('${USER_A}', '${randomUUID()}', 1, '{}'::jsonb, '[]'::jsonb, '${randomUUID()}', 'fp')`,
        `SELECT * FROM private.quote_idempotency_keys`,
        `SELECT * FROM private.quote_counters`,
      ]) {
        await expect(asRole(db, "authenticated", USER_A, () => db.query(sql))).rejects.toThrow(
          /permission denied/,
        );
      }
    });

    it("service_role tampoco puede modificar ni borrar líneas directamente", async () => {
      const quote = await createQuote(await seedEvent(USER_A));

      await expect(
        asRole(db, "service_role", null, () =>
          db.query(`DELETE FROM public.quote_lines WHERE quote_id = $1`, [quote.id]),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asRole(db, "service_role", null, () =>
          db.query(`UPDATE public.quote_lines SET quantity = 1 WHERE quote_id = $1`, [quote.id]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
