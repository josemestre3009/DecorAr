// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { calculateQuote } from "../../src/modules/quotes/domain/quote-totals";
import type { QuoteLineSnapshot } from "../../src/modules/quotes/domain/quote";

/**
 * DECOR-53: enlace público revocable de una cotización.
 *
 * Aplica todas las migraciones en PostgreSQL embebido (PGlite) y prueba:
 * solo cotizaciones enviadas/aceptadas se pueden compartir, idempotencia de
 * la creación, vigencia acotada a `valid_until`, revocación manual y
 * automática al versionar, lectura pública uniforme ante cualquier motivo de
 * rechazo, y que `anon`/`authenticated` no tienen ningún permiso directo.
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

type QuoteRow = { id: string; quote_number: number; version: number; status: string };
type ShareLinkRow = {
  id: string;
  quoteId: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
};

const TERMS = { depositRateBp: 5_000, discountRateBp: 1_000, taxRateBp: 1_900 };
const SNAPSHOT: QuoteLineSnapshot[] = [
  { moduleId: MODULE_ARCO, name: "Arco floral", quantity: 2, unitPriceCop: 150_000 },
  { moduleId: MODULE_SILLA, name: "Silla", quantity: 10, unitPriceCop: 20_000 },
];

/**
 * Hash SHA-256 del token, como `Uint8Array`: el mismo valor que
 * `ShareTokenSigner.hash` produce en la aplicación. PGlite serializa un
 * parámetro `bytea` a partir de su tipo JS, así que debe ser un
 * `Uint8Array`/`Buffer`, nunca una cadena hex.
 */
function tokenHashOf(token: string): Uint8Array {
  return createHash("sha256").update(token).digest();
}

describe("DECOR-53: enlace público revocable de una cotización", () => {
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

  async function seedEvent(userId = USER_A): Promise<string> {
    const packageId = randomUUID();
    await db.query(
      `INSERT INTO public.packages (id, user_id, name, client_name, event_date, venue, event_type, version)
       VALUES ($1, $2, 'Boda Ana', 'Ana Pérez', '2026-12-20', 'Club', 'boda', 1)`,
      [packageId, userId],
    );
    for (let i = 0; i < 2; i += 1) {
      await db.query(`INSERT INTO public.package_items (id, package_id, module_id) VALUES ($1, $2, $3)`, [
        randomUUID(),
        packageId,
        MODULE_ARCO,
      ]);
    }
    for (let i = 0; i < 10; i += 1) {
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
    owner = USER_A,
    validUntil = "2026-12-31",
  ): Promise<QuoteRow> {
    const calculation = calculateQuote(SNAPSHOT, TERMS);
    if (!calculation.ok) throw calculation.error;
    const { totals } = calculation.value;

    const result = await db.query<{ result: QuoteRow }>(
      `SELECT public.create_quote($1, $2, 1, $3::jsonb, $4::jsonb) AS result`,
      [
        owner,
        packageId,
        JSON.stringify({
          conditions: null,
          depositCop: totals.depositCop,
          discountCop: totals.discountCop,
          subtotalCop: totals.subtotalCop,
          taxCop: totals.taxCop,
          totalCop: totals.totalCop,
          validUntil,
          ...TERMS,
        }),
        JSON.stringify(calculation.value.lines),
      ],
    );
    return result.rows[0].result;
  }

  async function sendQuote(quoteId: string, owner = USER_A): Promise<void> {
    await db.query(`SELECT public.change_quote_status($1, $2, 'sent')`, [owner, quoteId]);
  }

  async function createLink(
    quoteId: string,
    owner = USER_A,
    expiresAt = "2026-12-31T00:00:00Z",
    linkId = randomUUID(),
    token = randomUUID(),
  ) {
    const result = await db.query<{ result: ShareLinkRow }>(
      `SELECT public.create_quote_share_link($1, $2, $3, $4::bytea, $5::timestamptz) AS result`,
      [owner, quoteId, linkId, tokenHashOf(token), expiresAt],
    );
    return { link: result.rows[0].result, token };
  }

  async function getSharedQuote(token: string) {
    const result = await db.query<{ result: unknown }>(`SELECT public.get_shared_quote($1::bytea) AS result`, [
      tokenHashOf(token),
    ]);
    return result.rows[0].result;
  }

  it("rechaza compartir un borrador", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);

    await expect(createLink(quote.id)).rejects.toThrow("quote.share_not_allowed");
  });

  it("crea el enlace de una cotización enviada y limita la vigencia a valid_until", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId, USER_A, "2026-12-01");
    await sendQuote(quote.id);

    const { link } = await createLink(quote.id, USER_A, "2026-11-25T00:00:00Z");
    expect(link.quoteId).toBe(quote.id);
    expect(link.revokedAt).toBeNull();

    // America/Bogota es UTC-5: medianoche del 2 de diciembre = 05:00 UTC.
    await expect(createLink(quote.id, USER_A, "2026-12-02T06:00:00Z")).rejects.toThrow(
      "quote.share_expiry_too_far",
    );
  });

  it("crea el enlace de una cotización aceptada", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);
    await db.query(`SELECT public.change_quote_status($1, $2, 'accepted')`, [USER_A, quote.id]);

    const { link } = await createLink(quote.id);
    expect(link.quoteId).toBe(quote.id);
  });

  it("reintentar la creación devuelve el mismo enlace mientras siga vigente", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);

    const first = await createLink(quote.id);
    const second = await createLink(quote.id);

    expect(second.link.id).toBe(first.link.id);
    // El segundo intento con un token distinto no reemplaza el hash activo:
    // el primer token sigue siendo válido.
    expect(await getSharedQuote(first.token)).not.toBeNull();
  });

  it("un enlace activo vencido se reemplaza por uno nuevo", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);

    const expired = await createLink(quote.id, USER_A, "2026-01-01T00:00:00Z");
    const replacement = await createLink(quote.id, USER_A, "2026-12-01T00:00:00Z");

    expect(replacement.link.id).not.toBe(expired.link.id);
    expect(await getSharedQuote(expired.token)).toBeNull();
    expect(await getSharedQuote(replacement.token)).not.toBeNull();
  });

  it("solo un enlace activo por cotización (índice único parcial)", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);

    await createLink(quote.id);

    await expect(
      db.query(
        `INSERT INTO private.quote_share_links (quote_id, owner_id, token_hash, expires_at)
         VALUES ($1, $2, $3::bytea, now() + interval '1 day')`,
        [quote.id, USER_A, tokenHashOf(randomUUID())],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("lectura pública: enlace vigente, vencido, revocado o de cotización no compartible dan la misma respuesta", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);
    const { token } = await createLink(quote.id);

    expect(await getSharedQuote(token)).not.toBeNull();
    expect(await getSharedQuote(randomUUID())).toBeNull();

    await db.query(`SELECT public.revoke_quote_share_link($1, $2)`, [USER_A, quote.id]);
    expect(await getSharedQuote(token)).toBeNull();
  });

  it("lectura pública: una cotización que volvió a borrador (vía trigger de versión) deja de ser visible", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);
    const { token } = await createLink(quote.id);

    expect(await getSharedQuote(token)).not.toBeNull();

    // Vencer la cotización no cambia el enlace en sí, pero get_shared_quote
    // ya no debe devolver nada porque el estado deja de ser compartible.
    await db.query(`SELECT public.change_quote_status($1, $2, 'expired')`, [USER_A, quote.id]);
    expect(await getSharedQuote(token)).toBeNull();
  });

  it("revocar sin enlace activo responde con un error identificable", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);

    await expect(
      db.query(`SELECT public.revoke_quote_share_link($1, $2)`, [USER_A, quote.id]),
    ).rejects.toThrow("quote.share_link_not_found");
  });

  it("get_quote_share_link devuelve null sin enlace activo y el enlace tras crearlo", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);

    const before = await db.query<{ result: ShareLinkRow | null }>(
      `SELECT public.get_quote_share_link($1, $2) AS result`,
      [USER_A, quote.id],
    );
    expect(before.rows[0].result).toBeNull();

    const { link } = await createLink(quote.id);
    const after = await db.query<{ result: ShareLinkRow }>(
      `SELECT public.get_quote_share_link($1, $2) AS result`,
      [USER_A, quote.id],
    );
    expect(after.rows[0].result.id).toBe(link.id);
  });

  it("crear una versión nueva revoca el enlace de la versión anterior", async () => {
    const packageId = await seedEvent();
    const v1 = await createQuote(packageId);
    await sendQuote(v1.id);
    const { token } = await createLink(v1.id);

    expect(await getSharedQuote(token)).not.toBeNull();

    const calculation = calculateQuote(SNAPSHOT, TERMS);
    if (!calculation.ok) throw calculation.error;
    const { totals } = calculation.value;
    await db.query(
      `SELECT public.create_quote_version($1, $2, 1, $3::jsonb, $4::jsonb)`,
      [
        USER_A,
        v1.id,
        JSON.stringify({
          conditions: null,
          depositCop: totals.depositCop,
          discountCop: totals.discountCop,
          subtotalCop: totals.subtotalCop,
          taxCop: totals.taxCop,
          totalCop: totals.totalCop,
          validUntil: "2026-12-31",
          ...TERMS,
        }),
        JSON.stringify(calculation.value.lines),
      ],
    );

    expect(await getSharedQuote(token)).toBeNull();
  });

  it("B no puede crear, consultar ni revocar el enlace de una cotización de A", async () => {
    const packageId = await seedEvent(USER_A);
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);

    await expect(createLink(quote.id, USER_B)).rejects.toThrow("quote.not_found");
    await expect(
      db.query(`SELECT public.get_quote_share_link($1, $2)`, [USER_B, quote.id]),
    ).rejects.toThrow("quote.not_found");
    await expect(
      db.query(`SELECT public.revoke_quote_share_link($1, $2)`, [USER_B, quote.id]),
    ).rejects.toThrow("quote.not_found");
  });

  it("anon y authenticated no tienen ningún permiso directo sobre quote_share_links", async () => {
    const packageId = await seedEvent();
    const quote = await createQuote(packageId);
    await sendQuote(quote.id);
    await createLink(quote.id);

    await expect(
      asRole(db, "anon", null, () => db.query(`SELECT id FROM private.quote_share_links`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, "authenticated", USER_A, () => db.query(`SELECT id FROM private.quote_share_links`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, "authenticated", USER_A, () =>
        db.query(`SELECT public.get_shared_quote($1::bytea)`, [tokenHashOf(randomUUID())]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
