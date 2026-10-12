import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  planSeedUser,
  readSeedConfig,
  SEED_MARK,
  seedE2E,
  verifyCatalog,
  type CatalogRow,
  type ExistingUser,
} from "./seed-e2e";

const env = {
  DECOR_E2E_USER_A_EMAIL: " Decor39-A@decorar.test ",
  DECOR_E2E_USER_A_PASSWORD: "clave-a",
  DECOR_E2E_USER_B_EMAIL: "decor39-b@decorar.test",
  DECOR_E2E_USER_B_PASSWORD: "clave-b",
  NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

const row = (assetId: string, overrides: Partial<CatalogRow> = {}): CatalogRow => ({
  asset_id: assetId,
  glb_url: `https://res.cloudinary.com/demo/${assetId}.glb`,
  id: `id-${assetId}`,
  name: assetId,
  usdz_url: `https://res.cloudinary.com/demo/${assetId}.usdz`,
  version: 3,
  ...overrides,
});

describe("readSeedConfig", () => {
  it("normaliza los correos y conserva las contraseñas", () => {
    const config = readSeedConfig(env);

    expect(config.userA).toEqual({ email: "decor39-a@decorar.test", password: "clave-a" });
    expect(config.userB.email).toBe("decor39-b@decorar.test");
    expect(config.supabaseUrl).toBe("https://proyecto.supabase.co");
  });

  it("nombra todas las variables que faltan a la vez", () => {
    expect(() => readSeedConfig({ ...env, DECOR_E2E_USER_B_PASSWORD: "", SUPABASE_SERVICE_ROLE_KEY: undefined })).toThrow(
      "faltan variables de entorno: SUPABASE_SERVICE_ROLE_KEY, DECOR_E2E_USER_B_PASSWORD",
    );
  });

  it("rechaza que A y B sean la misma cuenta", () => {
    expect(() => readSeedConfig({ ...env, DECOR_E2E_USER_B_EMAIL: "DECOR39-A@decorar.test" })).toThrow(
      "correos distintos",
    );
  });
});

describe("verifyCatalog", () => {
  it("devuelve arco, mesa y pista activos con sus URLs", () => {
    const catalog = verifyCatalog([row("arco"), row("mesa", { version: 2 }), row("pista")]);

    expect(catalog.mesa).toEqual({
      assetId: "mesa",
      glbUrl: "https://res.cloudinary.com/demo/mesa.glb",
      id: "id-mesa",
      name: "mesa",
      usdzUrl: "https://res.cloudinary.com/demo/mesa.usdz",
      version: 2,
    });
    expect(Object.keys(catalog).sort()).toEqual(["arco", "mesa", "pista"]);
  });

  it("falla con instrucciones si falta un módulo o su USDZ no es HTTPS", () => {
    expect(() => verifyCatalog([row("arco"), row("mesa", { usdz_url: null })])).toThrow(
      /mesa@v3: GLB y USDZ deben ser URLs HTTPS; pista: no hay versión activa.*catalog:publish-assets/,
    );
  });
});

describe("planSeedUser", () => {
  const user = { email: "decor39-a@decorar.test", password: "clave-a" };

  it("crea la cuenta cuando no existe", () => {
    expect(planSeedUser(null, user)).toEqual({ kind: "create" });
  });

  it("reajusta la cuenta que ya creó el seed", () => {
    expect(planSeedUser({ app_metadata: { provider: "email", [SEED_MARK]: true }, id: "user-a" }, user)).toEqual({
      id: "user-a",
      kind: "update",
    });
  });

  it("se detiene ante una cuenta existente sin la marca", () => {
    expect(() => planSeedUser({ app_metadata: { provider: "email" }, id: "real" }, user)).toThrow(
      /decor39-a@decorar\.test ya existe y no es una cuenta creada por este seed/,
    );
    expect(() => planSeedUser({ app_metadata: { [SEED_MARK]: "true" }, id: "real" }, user)).toThrow(SEED_MARK);
    expect(() => planSeedUser({ app_metadata: null, id: "real" }, user)).toThrow(SEED_MARK);
  });
});

describe("seedE2E", () => {
  function fakeAdmin(users: Array<ExistingUser & { email: string }>) {
    const writes = {
      createUser: vi.fn(),
      from: vi.fn(),
      updateUserById: vi.fn(),
    };
    const admin = {
      auth: {
        admin: {
          createUser: writes.createUser,
          listUsers: vi.fn(async () => ({ data: { users }, error: null })),
          updateUserById: writes.updateUserById,
        },
      },
      from: writes.from,
    } as unknown as SupabaseClient;
    return { admin, writes };
  }

  it("no escribe nada si B pertenece a una cuenta sin la marca, aunque A sea del seed", async () => {
    const { admin, writes } = fakeAdmin([
      { app_metadata: { [SEED_MARK]: true }, email: "decor39-a@decorar.test", id: "user-a" },
      { app_metadata: { provider: "email" }, email: "decor39-b@decorar.test", id: "real-b" },
    ]);

    await expect(seedE2E(readSeedConfig(env), admin)).rejects.toThrow(/decor39-b@decorar\.test ya existe/);

    expect(writes.updateUserById).not.toHaveBeenCalled();
    expect(writes.createUser).not.toHaveBeenCalled();
    expect(writes.from).not.toHaveBeenCalled();
  });
});
