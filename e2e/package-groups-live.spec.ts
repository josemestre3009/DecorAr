/**
 * DECOR-25: smoke test del Composite contra la API real y el Supabase alojado.
 *
 * Opt-in: solo corre con DECOR_LIVE_SMOKE=1 y las variables de Supabase, porque
 * crea un usuario real. Requiere la migración
 * 20261012000000_create_package_groups.sql aplicada en el proyecto alojado.
 * El usuario se crea con la admin API y `email_confirm: true` (mismo enfoque que
 * DECOR-30/38) y se elimina al final junto con su paquete (cascada a grupos e
 * ítems).
 *
 *   DECOR_LIVE_SMOKE=1 node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/package-groups-live.spec.ts
 *
 * Con un `npm run dev` ya levantado, añade DECOR_E2E_BASE_URL=http://localhost:3000.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled = process.env.DECOR_LIVE_SMOKE === "1" && Boolean(url && serviceRoleKey);
const disabledReason = "requiere DECOR_LIVE_SMOKE=1, NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY";

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };

type CatalogModule = { id: string; assetId: string; name: string };
type CreatedGroup = { groupId: string; depth: number; itemIds: string[]; packageVersion: number };

test.describe.serial("DECOR-25 Composite contra la API real (smoke)", () => {
  test.skip(!enabled, disabledReason);

  const admin = enabled ? createClient(url, serviceRoleKey, noSession) : (null as never);
  const email = `decor25-smoke-${randomUUID()}@decorar.test`;
  const password = `${randomUUID()}Aa1!`;
  let userId: string | null = null;
  let packageId: string | null = null;

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  });

  test.afterAll(async () => {
    if (packageId) await admin.from("packages").delete().eq("id", packageId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/packages$/);
  }

  test("crea la Zona de bienvenida, un subgrupo y una hoja dentro del grupo", async ({ page }) => {
    await signIn(page);

    const createdPackage = await page.request.post("/api/packages", {
      data: { capacityM2: 50, spaceType: "salonSocial" },
    });
    expect(createdPackage.status()).toBe(201);
    packageId = ((await createdPackage.json()) as { id: string }).id;

    const catalog = (await (await page.request.get("/api/modules")).json()) as CatalogModule[];
    const arco = catalog.find((module) => module.assetId === "arco");
    const mesa = catalog.find((module) => module.assetId === "mesa");
    expect(arco, "el catálogo debe tener el arco activo").toBeDefined();
    expect(mesa, "el catálogo debe tener la mesa activa").toBeDefined();

    const zonaResponse = await page.request.post(`/api/packages/${packageId}/groups`, {
      data: { children: [{ moduleId: arco!.id }, { moduleId: mesa!.id }], name: "Zona de bienvenida" },
    });
    expect(zonaResponse.status(), await zonaResponse.text()).toBe(201);
    const zona = (await zonaResponse.json()) as CreatedGroup;
    expect(zona.depth).toBe(1);
    expect(zona.itemIds).toHaveLength(2);

    const subResponse = await page.request.post(`/api/packages/${packageId}/groups`, {
      data: { name: "Mesa de regalos", parentGroupId: zona.groupId },
    });
    expect(subResponse.status(), await subResponse.text()).toBe(201);
    const sub = (await subResponse.json()) as CreatedGroup;
    expect(sub.depth).toBe(2);

    const leafResponse = await page.request.post(`/api/packages/${packageId}/items`, {
      data: { moduleId: mesa!.id, parentGroupId: sub.groupId },
    });
    expect(leafResponse.status(), await leafResponse.text()).toBe(201);

    const blankGroup = await page.request.post(`/api/packages/${packageId}/items`, {
      data: { moduleId: mesa!.id, parentGroupId: "   " },
    });
    expect(blankGroup.status()).toBe(400);
    expect(((await blankGroup.json()) as { error: { code: string } }).error.code).toBe("package.invalid_group");

    const groups = await admin.from("package_groups").select("id, depth").eq("package_id", packageId);
    expect(groups.error).toBeNull();
    expect(groups.data).toHaveLength(2);

    const items = await admin.from("package_items").select("group_id").eq("package_id", packageId);
    expect(items.error).toBeNull();
    const inZona = items.data!.filter((item) => item.group_id === zona.groupId).length;
    const inSub = items.data!.filter((item) => item.group_id === sub.groupId).length;
    expect([inZona, inSub]).toEqual([2, 1]);
  });

  test("sin sesión la creación de grupos responde 401", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    const response = await anonymous.post(`/api/packages/${packageId ?? randomUUID()}/groups`, {
      data: { name: "Intruso" },
    });
    expect(response.status()).toBe(401);
    await anonymous.dispose();
  });
});
