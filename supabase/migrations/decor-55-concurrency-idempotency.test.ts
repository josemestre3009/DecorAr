// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { calculateQuote } from "../../src/modules/quotes/domain/quote-totals";
import type { QuoteLineSnapshot } from "../../src/modules/quotes/domain/quote";

/**
 * DECOR-55: idempotencia y concurrencia optimista de cotizaciones.
 *
 * Aplica todas las migraciones en PostgreSQL embebido (PGlite) y prueba que
 * un reintento con la misma Idempotency-Key no asigna otro número ni otra
 * versión, que la misma clave con otra solicitud se rechaza, que una versión
 * o un estado obsoletos responden con conflicto sin escribir, y que el
 * registro de claves es privado y por dueño. PGlite usa una sola conexión:
 * las carreras se simulan en secuencia (el reintento llega después de que el
 * primer intento confirmó), que es el caso que la clave debe absorber.
 */

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MODULE_SILLA = "11111111-1111-4111-8111-111111111111";

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

type QuoteRow = {
  id: string;
  quote_number: number;
  version: number;
  status: string;
  replayed?: boolean;
};

const TERMS = { depositRateBp: 5_000, discountRateBp: 1_000, taxRateBp: 1_900 };
const SNAPSHOT: QuoteLineSnapshot[] = [{ moduleId: MODULE_SILLA, name: "Silla", quantity: 3, unitPriceCop: 20_000 }];

function payload(validUntil = "2026-12-31"): { quote: string; lines: string } {
  const calculation = calculateQuote(SNAPSHOT, TERMS);
  if (!calculation.ok) throw calculation.error;
  const { totals } = calculation.value;
  return {
    lines: JSON.stringify(calculation.value.lines),
    quote: JSON.stringify({
      conditions: null,
      depositCop: totals.depositCop,
      discountCop: totals.discountCop,
      subtotalCop: totals.subtotalCop,
      taxCop: totals.taxCop,
      totalCop: totals.totalCop,
      validUntil,
      ...TERMS,
    }),
  };
}

describe("DECOR-55: idempotencia y concurrencia de cotizaciones", () => {
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
       'https://example.com/s.glb', 'https://example.com/s.usdz', null, 'active');
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedEvent(userId = USER_A): Promise<string> {
    const packageId = randomUUID();
    await db.query(
      `INSERT INTO public.packages (id, user_id, name, client_name, event_date, venue, event_type, version)
       VALUES ($1, $2, 'Boda', 'Ana', '2026-12-20', 'Club', 'boda', 1)`,
      [packageId, userId],
    );
    for (let i = 0; i < 3; i += 1) {
      await db.query(`INSERT INTO public.package_items (id, package_id, module_id) VALUES ($1, $2, $3)`, [
        randomUUID(),
        packageId,
        MODULE_SILLA,
      ]);
    }
    return packageId;
  }

  async function createQuote(
    packageId: string,
    key: string,
    fingerprint: string,
    owner = USER_A,
    data = payload(),
  ): Promise<QuoteRow> {
    const result = await db.query<{ result: QuoteRow }>(
      `SELECT public.create_quote($1, $2, 1, $3::jsonb, $4::jsonb, $5, $6) AS result`,
      [owner, packageId, data.quote, data.lines, key, fingerprint],
    );
    return result.rows[0].result;
  }

  async function createVersion(
    quoteId: string,
    expectedVersion: number,
    key: string,
    fingerprint: string,
    owner = USER_A,
  ): Promise<QuoteRow> {
    const data = payload("2027-01-15");
    const result = await db.query<{ result: QuoteRow }>(
      `SELECT public.create_quote_version($1, $2, 1, $3::jsonb, $4::jsonb, $5, $6, $7) AS result`,
      [owner, quoteId, data.quote, data.lines, expectedVersion, key, fingerprint],
    );
    return result.rows[0].result;
  }

  async function changeStatus(quoteId: string, status: string, expected: string, owner = USER_A) {
    const result = await db.query<{ result: QuoteRow }>(
      `SELECT public.change_quote_status($1, $2, $3, $4) AS result`,
      [owner, quoteId, status, expected],
    );
    return result.rows[0].result;
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const result = await db.query<{ count: string }>(sql, params);
    return Number(result.rows[0].count);
  }

  const quotesOf = (owner: string) => count(`SELECT count(*) AS count FROM public.quotes WHERE owner_id = $1`, [owner]);

  describe("crear cotización", () => {
    it("un reintento con la misma clave devuelve la misma cotización sin consumir otro número", async () => {
      const packageId = await seedEvent();
      const key = randomUUID();
      const before = await quotesOf(USER_A);

      const first = await createQuote(packageId, key, "fp-crear");
      const retry = await createQuote(packageId, key, "fp-crear");

      expect(first.replayed).toBe(false);
      expect(retry.replayed).toBe(true);
      expect(retry.id).toBe(first.id);
      expect(retry.quote_number).toBe(first.quote_number);
      expect(await quotesOf(USER_A)).toBe(before + 1);

      const next = await createQuote(packageId, randomUUID(), "fp-crear");
      expect(next.quote_number).toBe(first.quote_number + 1);
    });

    it("la misma clave con otra solicitud se rechaza y no crea nada", async () => {
      const packageId = await seedEvent();
      const key = randomUUID();
      await createQuote(packageId, key, "fp-original");
      const before = await quotesOf(USER_A);

      await expect(createQuote(packageId, key, "fp-distinta")).rejects.toThrow("idempotency.key_reused");
      expect(await quotesOf(USER_A)).toBe(before);
    });

    it("sin clave o sin huella responde idempotency.key_invalid", async () => {
      const packageId = await seedEvent();
      const data = payload();

      await expect(
        db.query(`SELECT public.create_quote($1, $2, 1, $3::jsonb, $4::jsonb, NULL, 'fp')`, [
          USER_A,
          packageId,
          data.quote,
          data.lines,
        ]),
      ).rejects.toThrow("idempotency.key_invalid");
      await expect(createQuote(packageId, randomUUID(), "")).rejects.toThrow("idempotency.key_invalid");
    });

    it("las claves son por dueño: B puede usar la misma clave sin ver la cotización de A", async () => {
      const key = randomUUID();
      const quoteA = await createQuote(await seedEvent(USER_A), key, "fp");
      const quoteB = await createQuote(await seedEvent(USER_B), key, "fp", USER_B);

      expect(quoteB.replayed).toBe(false);
      expect(quoteB.id).not.toBe(quoteA.id);
    });

    it("si la creación falla no queda la clave registrada y el reintento puede crear", async () => {
      const packageId = await seedEvent();
      const key = randomUUID();
      const badLines = JSON.stringify([]);

      await expect(
        db.query(`SELECT public.create_quote($1, $2, 1, $3::jsonb, $4::jsonb, $5, 'fp')`, [
          USER_A,
          packageId,
          payload().quote,
          badLines,
          key,
        ]),
      ).rejects.toThrow();
      expect(
        await count(`SELECT count(*) AS count FROM private.quote_idempotency_keys WHERE idempotency_key = $1`, [key]),
      ).toBe(0);

      const created = await createQuote(packageId, key, "fp");
      expect(created.replayed).toBe(false);
    });
  });

  describe("nueva versión", () => {
    it("un reintento con la misma clave no crea una versión 3", async () => {
      const v1 = await createQuote(await seedEvent(), randomUUID(), "fp");
      const key = randomUUID();

      const v2 = await createVersion(v1.id, 1, key, "fp-v2");
      const retry = await createVersion(v1.id, 1, key, "fp-v2");

      expect(v2).toMatchObject({ replayed: false, version: 2 });
      expect(retry).toMatchObject({ id: v2.id, replayed: true, version: 2 });
      expect(
        await count(`SELECT count(*) AS count FROM public.quotes WHERE owner_id = $1 AND quote_number = $2`, [
          USER_A,
          v1.quote_number,
        ]),
      ).toBe(2);
    });

    it("con una versión esperada obsoleta responde quote.version_conflict con la versión actual y no escribe", async () => {
      const v1 = await createQuote(await seedEvent(), randomUUID(), "fp");
      await createVersion(v1.id, 1, randomUUID(), "fp-ana");

      // Otra pestaña que todavía ve la versión 1 intenta guardar sus cambios.
      const stale = createVersion(v1.id, 1, randomUUID(), "fp-luis");

      await expect(stale).rejects.toMatchObject({
        detail: "2",
        message: expect.stringContaining("quote.version_conflict"),
      });
      expect(
        await count(`SELECT count(*) AS count FROM public.quotes WHERE owner_id = $1 AND quote_number = $2`, [
          USER_A,
          v1.quote_number,
        ]),
      ).toBe(2);
    });

    it("rechaza una versión esperada ausente o menor que 1", async () => {
      const v1 = await createQuote(await seedEvent(), randomUUID(), "fp");

      await expect(createVersion(v1.id, 0, randomUUID(), "fp")).rejects.toThrow("quote.invalid_body");
    });

    it("una clave usada para crear no sirve para versionar (otra operación)", async () => {
      const key = randomUUID();
      const v1 = await createQuote(await seedEvent(), key, "fp");

      await expect(createVersion(v1.id, 1, key, "fp")).rejects.toThrow("idempotency.key_reused");
    });

    it("B no puede versionar la cotización de A ni con la clave de A", async () => {
      const key = randomUUID();
      const v1 = await createQuote(await seedEvent(USER_A), randomUUID(), "fp");
      await createVersion(v1.id, 1, key, "fp-v2");

      await expect(createVersion(v1.id, 2, key, "fp-v2", USER_B)).rejects.toThrow("quote.not_found");
    });
  });

  describe("cambio de estado", () => {
    it("repetir un cambio que ya ocurrió no falla ni lo vuelve a aplicar", async () => {
      const quote = await createQuote(await seedEvent(), randomUUID(), "fp");

      expect((await changeStatus(quote.id, "sent", "draft")).status).toBe("sent");
      expect((await changeStatus(quote.id, "sent", "draft")).status).toBe("sent");
    });

    it("si otro usuario ya cambió el estado responde quote.status_conflict con el estado actual", async () => {
      const quote = await createQuote(await seedEvent(), randomUUID(), "fp");
      await changeStatus(quote.id, "sent", "draft");
      await changeStatus(quote.id, "accepted", "sent");

      // Una pestaña que aún ve "draft" intenta vencerla.
      await expect(changeStatus(quote.id, "expired", "draft")).rejects.toMatchObject({
        detail: "accepted",
        message: expect.stringContaining("quote.status_conflict"),
      });
      expect(
        (await db.query<{ status: string }>(`SELECT status FROM public.quotes WHERE id = $1`, [quote.id])).rows[0]
          .status,
      ).toBe("accepted");
    });

    it("B no puede cambiar el estado de una cotización de A", async () => {
      const quote = await createQuote(await seedEvent(USER_A), randomUUID(), "fp");

      await expect(changeStatus(quote.id, "sent", "draft", USER_B)).rejects.toThrow("quote.not_found");
    });
  });

  describe("privilegios del registro de claves", () => {
    it("anon y authenticated no leen el registro ni ejecutan las RPC nuevas", async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role};`);
        try {
          await expect(db.query(`SELECT * FROM private.quote_idempotency_keys`)).rejects.toMatchObject({
            code: "42501",
          });
          await expect(
            db.query(`SELECT public.create_quote($1, $2, 1, '{}'::jsonb, '[]'::jsonb, $3, 'fp')`, [
              USER_A,
              randomUUID(),
              randomUUID(),
            ]),
          ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await db.exec("RESET ROLE;");
        }
      }
    });

    it("el registro guarda sólo la huella hasheada, no la solicitud", async () => {
      const key = randomUUID();
      await createQuote(await seedEvent(), key, "fp-con-datos-de-cliente");

      const row = await db.query<{ request_fingerprint: Uint8Array }>(
        `SELECT request_fingerprint FROM private.quote_idempotency_keys WHERE idempotency_key = $1`,
        [key],
      );
      expect(row.rows[0].request_fingerprint).toHaveLength(32);
      expect(Buffer.from(row.rows[0].request_fingerprint).toString("utf8")).not.toContain("cliente");
    });
  });
});
