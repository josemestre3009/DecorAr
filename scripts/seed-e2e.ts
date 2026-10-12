/**
 * DECOR-39: seed idempotente para la E2E móvil, ejecutado en el servidor contra
 * el Supabase alojado de pruebas con la service role.
 *
 *   npm run e2e:seed
 *
 * Cada ejecución deja el mismo estado:
 * - usuarios A y B dedicados (correo confirmado, contraseña de .env), creados
 *   si faltan con la marca `app_metadata.decor_e2e_seed` y con la contraseña
 *   reajustada si ya existen;
 * - sin paquetes de A ni de B (los ítems, grupos, presupuestos y eventos caen
 *   en cascada). No toca datos de ningún otro usuario;
 *
 * Salvaguarda: si un correo configurado pertenece a una cuenta sin la marca
 * (una cuenta real o creada a mano), el seed se detiene antes de escribir nada:
 * ni contraseña, ni confirmación, ni borrado de paquetes. Solo la service role
 * puede escribir `app_metadata`, así que nadie se puede automarcar.
 * - catálogo verificado: arco, mesa y pista activos con GLB y USDZ HTTPS. Si
 *   faltan, falla con un mensaje claro; activarlos es de DECOR-36
 *   (`npm run catalog:publish-assets`), no de este seed.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export const REQUIRED_ASSET_IDS = ["arco", "mesa", "pista"] as const;

export type SeedUser = { readonly email: string; readonly password: string };

export type SeedConfig = {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly userA: SeedUser;
  readonly userB: SeedUser;
};

export type CatalogRow = {
  readonly id: string;
  readonly asset_id: string;
  readonly version: number;
  readonly name: string;
  readonly glb_url: string | null;
  readonly usdz_url: string | null;
};

export type SeededModule = {
  readonly id: string;
  readonly assetId: string;
  readonly version: number;
  readonly name: string;
  readonly glbUrl: string;
  readonly usdzUrl: string;
};

export type SeedResult = {
  readonly userIds: { readonly a: string; readonly b: string };
  readonly deletedPackages: number;
  readonly catalog: Record<(typeof REQUIRED_ASSET_IDS)[number], SeededModule>;
};

type Env = Readonly<Record<string, string | undefined>>;

/** Lee y valida la configuración; nombra todas las variables que faltan a la vez. */
export function readSeedConfig(env: Env): SeedConfig {
  const names = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DECOR_E2E_USER_A_EMAIL",
    "DECOR_E2E_USER_A_PASSWORD",
    "DECOR_E2E_USER_B_EMAIL",
    "DECOR_E2E_USER_B_PASSWORD",
  ] as const;
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Seed E2E: faltan variables de entorno: ${missing.join(", ")}.`);
  }

  const value = (name: (typeof names)[number]) => (env[name] as string).trim();
  const userA = { email: value("DECOR_E2E_USER_A_EMAIL").toLowerCase(), password: value("DECOR_E2E_USER_A_PASSWORD") };
  const userB = { email: value("DECOR_E2E_USER_B_EMAIL").toLowerCase(), password: value("DECOR_E2E_USER_B_PASSWORD") };
  if (userA.email === userB.email) {
    throw new Error("Seed E2E: los usuarios A y B deben tener correos distintos.");
  }

  return {
    supabaseUrl: value("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: value("SUPABASE_SERVICE_ROLE_KEY"),
    userA,
    userB,
  };
}

const isHttps = (url: string | null): url is string => typeof url === "string" && url.startsWith("https://");

/**
 * Comprueba que el catálogo activo trae los módulos del flujo de demo. Devuelve
 * el módulo por assetId o lanza un error que explica cómo activarlos.
 */
export function verifyCatalog(rows: readonly CatalogRow[]): SeedResult["catalog"] {
  const found: Partial<Record<(typeof REQUIRED_ASSET_IDS)[number], SeededModule>> = {};
  const problems: string[] = [];

  for (const assetId of REQUIRED_ASSET_IDS) {
    const row = rows.find((candidate) => candidate.asset_id === assetId);
    if (!row) {
      problems.push(`${assetId}: no hay versión activa`);
      continue;
    }
    if (!isHttps(row.glb_url) || !isHttps(row.usdz_url)) {
      problems.push(`${assetId}@v${row.version}: GLB y USDZ deben ser URLs HTTPS`);
      continue;
    }
    found[assetId] = {
      id: row.id,
      assetId,
      version: row.version,
      name: row.name,
      glbUrl: row.glb_url,
      usdzUrl: row.usdz_url,
    };
  }

  if (problems.length > 0) {
    throw new Error(
      `Seed E2E: el catálogo alojado no está listo (${problems.join("; ")}). ` +
        "Publica y activa los módulos con `npm run catalog:publish-assets` (DECOR-36).",
    );
  }

  return found as SeedResult["catalog"];
}

/** Marca en `app_metadata` de las cuentas que creó este seed. */
export const SEED_MARK = "decor_e2e_seed";

export type ExistingUser = {
  readonly id: string;
  readonly app_metadata?: Readonly<Record<string, unknown>> | null;
};

export type SeedUserPlan = { readonly kind: "create" } | { readonly kind: "update"; readonly id: string };

/**
 * Decide qué hacer con un usuario A/B sin escribir nada: crearlo si no existe,
 * reajustarlo si lo creó este seed, o detenerse si es una cuenta ajena.
 */
export function planSeedUser(existing: ExistingUser | null, user: SeedUser): SeedUserPlan {
  if (!existing) return { kind: "create" };
  if (existing.app_metadata?.[SEED_MARK] === true) return { id: existing.id, kind: "update" };

  throw new Error(
    `Seed E2E: ${user.email} ya existe y no es una cuenta creada por este seed ` +
      `(falta app_metadata.${SEED_MARK}). No se cambió su contraseña ni se borraron sus paquetes. ` +
      "Usa correos dedicados a la E2E en DECOR_E2E_USER_A_EMAIL / DECOR_E2E_USER_B_EMAIL.",
  );
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<ExistingUser | null> {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < perPage) return null;
  }
}

/** Aplica el plan: crea el usuario marcado o le devuelve la contraseña y el correo confirmado. */
async function applySeedUser(admin: SupabaseClient, user: SeedUser, plan: SeedUserPlan): Promise<string> {
  const appMetadata = { [SEED_MARK]: true };

  if (plan.kind === "update") {
    const { error } = await admin.auth.admin.updateUserById(plan.id, {
      app_metadata: appMetadata,
      email_confirm: true,
      password: user.password,
    });
    if (error) throw error;
    return plan.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    app_metadata: appMetadata,
    email: user.email,
    email_confirm: true,
    password: user.password,
  });
  if (error) throw error;
  return data.user.id;
}

export async function seedE2E(
  config: SeedConfig,
  admin: SupabaseClient = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
): Promise<SeedResult> {
  // Primero se verifican A y B; si cualquiera es ajena, no se escribe nada.
  const planA = planSeedUser(await findUserByEmail(admin, config.userA.email), config.userA);
  const planB = planSeedUser(await findUserByEmail(admin, config.userB.email), config.userB);

  const a = await applySeedUser(admin, config.userA, planA);
  const b = await applySeedUser(admin, config.userB, planB);

  // packages.user_id → auth.users; ítems, grupos, budgets y eventos cuelgan del
  // paquete con ON DELETE CASCADE. Solo se borran los paquetes de A y B, ya
  // verificados como cuentas del seed.
  const deleted = await admin.from("packages").delete().in("user_id", [a, b]).select("id");
  if (deleted.error) throw deleted.error;

  const catalog = await admin
    .from("catalog_modules")
    .select("id, asset_id, version, name, glb_url, usdz_url")
    .eq("status", "active")
    .in("asset_id", [...REQUIRED_ASSET_IDS]);
  if (catalog.error) throw catalog.error;

  return {
    catalog: verifyCatalog(catalog.data as CatalogRow[]),
    deletedPackages: deleted.data.length,
    userIds: { a, b },
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  seedE2E(readSeedConfig(process.env))
    .then((result) => {
      console.info(
        `Seed E2E listo: usuarios A/B preparados, ${result.deletedPackages} paquete(s) previos eliminados, ` +
          `catálogo ${REQUIRED_ASSET_IDS.map((id) => `${id}@v${result.catalog[id].version}`).join(", ")}.`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
