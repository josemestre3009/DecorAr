/**
 * editable-decorative-groups (DECOR-25 Composite editable): recorrido live
 * completo contra la API real y el Supabase alojado.
 *
 * Cubre crear evento, dos zonas + una subzona, módulos en raíz y zonas, mover
 * un módulo preservando `itemId`, renombrar una zona, eliminar con `move_to_root`
 * y con `delete_contents`, guardar la plantilla privada, instanciar un segundo
 * evento y verificar jerarquía con IDs nuevos e independencia entre origen,
 * plantilla y copia.
 *
 * Opt-in: solo corre con DECOR_LIVE_SMOKE=1, NEXT_PUBLIC_DECOR_PACKAGES_API=live
 * y las variables de Supabase, porque crea un usuario real (admin API,
 * `email_confirm: true`) que se elimina al final; eventos, ítems y plantillas se
 * borran en cascada. Playwright levanta `npm run dev` heredando el modo live.
 *
 *   DECOR_LIVE_SMOKE=1 NEXT_PUBLIC_DECOR_PACKAGES_API=live node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/editable-decorative-groups-live.spec.ts
 *
 * Requiere aplicadas 20261012000000_create_package_groups.sql,
 * 20261015000000_event_templates_and_metadata.sql y
 * 20261016000000_edit_package_groups.sql, además de al menos 5 módulos activos
 * en el catálogo (para tener instancias distinguibles por fila).
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled =
  process.env.DECOR_LIVE_SMOKE === "1" &&
  process.env.NEXT_PUBLIC_DECOR_PACKAGES_API === "live" &&
  Boolean(url && serviceRoleKey);
const disabledReason =
  "requiere DECOR_LIVE_SMOKE=1, NEXT_PUBLIC_DECOR_PACKAGES_API=live, NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY";

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const PACKAGE_URL = /\/packages\/[0-9a-f-]{36}$/;

const ROOT = "Zona Recepción";
const OTHER = "Zona Banquete";
const RENAMED = "Zona Renombrada";
const SUB_A = "Subzona Regalos";
const SUB_B = "Subzona Postres";
const EDITED = "Zona Editada";
const ROOT_LABEL = "(raíz)";

type CatalogModule = { id: string; name: string };
type GroupRow = { id: string; name: string; parent_group_id: string | null; depth: number };
type ItemRow = { id: string; module_id: string; group_id: string | null };
type TemplateRow = { id: string; name: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.use({ video: "on" });

test.describe.serial("editable-decorative-groups contra la API real", () => {
  test.skip(!enabled, disabledReason);

  const admin = enabled ? createClient(url, serviceRoleKey, noSession) : (null as never);
  const email = `decor25-zones-${randomUUID()}@decorar.test`;
  const password = `${randomUUID()}Aa1!`;
  let userId: string | null = null;

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  });

  test.afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/packages$/);
  }

  const eventId = (page: Page) => page.url().split("/").filter(Boolean).pop() as string;

  // --- Lectura directa de la jerarquía persistida --------------------------

  async function readGroups(packageId: string): Promise<GroupRow[]> {
    const { data, error } = await admin
      .from("package_groups")
      .select("id, name, parent_group_id, depth")
      .eq("package_id", packageId);
    if (error) throw error;
    return data as GroupRow[];
  }

  async function readItems(packageId: string): Promise<ItemRow[]> {
    const { data, error } = await admin
      .from("package_items")
      .select("id, module_id, group_id")
      .eq("package_id", packageId);
    if (error) throw error;
    return data as ItemRow[];
  }

  async function readTemplateGroups(templateId: string): Promise<GroupRow[]> {
    const { data, error } = await admin
      .from("event_template_groups")
      .select("id, name, parent_group_id, depth")
      .eq("template_id", templateId);
    if (error) throw error;
    return data as GroupRow[];
  }

  async function readTemplateItems(templateId: string): Promise<ItemRow[]> {
    const { data, error } = await admin
      .from("event_template_items")
      .select("id, module_id, group_id")
      .eq("template_id", templateId);
    if (error) throw error;
    return data as ItemRow[];
  }

  /** Forma estable de la jerarquía, sin IDs: `profundidad|padre|nombre`. */
  function hierarchy(rows: GroupRow[]): string[] {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return rows
      .map((row) => `${row.depth}|${row.parent_group_id ? byId.get(row.parent_group_id)!.name : ROOT_LABEL}|${row.name}`)
      .sort();
  }

  /** Ubicación de cada módulo: `nombreMódulo@nombreZona` (o raíz). */
  function placement(
    items: ItemRow[],
    groups: GroupRow[],
    moduleNameById: Map<string, string>,
  ): string[] {
    const groupName = new Map(groups.map((group) => [group.id, group.name]));
    return items
      .map(
        (item) =>
          `${moduleNameById.get(item.module_id) ?? item.module_id}@${
            item.group_id ? groupName.get(item.group_id) ?? item.group_id : ROOT_LABEL
          }`,
      )
      .sort();
  }

  // --- Selectores del editor inline ----------------------------------------

  const contents = (page: Page) =>
    page.getByRole("region", { name: "Contenido del evento", exact: true });
  const zoneToggle = (page: Page, name: string) =>
    contents(page).getByRole("button", { name: new RegExp(`^${escapeRegExp(name)} `) });
  /** `<li>` propio de la zona: ancestro `li` más cercano de su toggle. */
  const zoneRow = (page: Page, name: string) =>
    zoneToggle(page, name).locator("xpath=ancestor::li[1]");
  const rootList = (page: Page) => contents(page).locator(":scope > ul.content-list");
  const childList = (row: Locator) => row.locator(":scope > .content-children > ul.content-list");
  const rowActions = (row: Locator) => row.locator(":scope > .zone-actions");
  const moduleRow = (list: Locator, name: string) =>
    list
      .locator("> li")
      .filter({ has: list.page().getByRole("button", { name: `Quitar una unidad de ${name}` }) })
      .filter({ hasNot: list.page().locator(".group-toggle") })
      .first();

  async function expand(page: Page, name: string) {
    const toggle = zoneToggle(page, name);
    if ((await toggle.getAttribute("aria-expanded")) === "false") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }

  async function createRootZone(page: Page, name: string) {
    const form = contents(page).locator(":scope > form.zone-form");
    await form.getByLabel("Nombre de la zona").fill(name);
    await form.getByRole("button", { name: "Crear zona" }).click();
    await expect(zoneToggle(page, name)).toBeVisible();
  }

  async function createSubzone(page: Page, parent: string, name: string) {
    const row = zoneRow(page, parent);
    await rowActions(row).getByRole("button", { name: "Crear subzona" }).click();
    const form = row.locator(":scope > form.zone-form");
    await form.getByLabel("Nombre de la zona").fill(name);
    await form.getByRole("button", { name: "Crear subzona" }).click();
    await expect(zoneToggle(page, name)).toBeVisible();
  }

  async function addItem(
    page: Page,
    packageId: string,
    moduleId: string,
    groupId: string | null,
  ): Promise<string> {
    const response = await page.request.post(`/api/packages/${packageId}/items`, {
      data: groupId ? { moduleId, parentGroupId: groupId } : { moduleId },
    });
    expect(response.status(), await response.text()).toBe(201);
    return ((await response.json()) as { itemId: string }).itemId;
  }

  test("edita zonas, mueve un módulo, elimina con ambas estrategias y copia la jerarquía", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signIn(page);

    await page.getByLabel("Nombre del evento").fill(`Evento zonas ${randomUUID().slice(0, 8)}`);
    await page.getByRole("button", { name: "Crear evento" }).click();
    await expect(page).toHaveURL(PACKAGE_URL);
    const sourceId = eventId(page);

    const catalog = (await (await page.request.get("/api/modules")).json()) as CatalogModule[];
    expect(
      catalog.length,
      "el catálogo live debe tener al menos 5 módulos activos",
    ).toBeGreaterThanOrEqual(5);
    const [mRoot, mA, mB, mPost, mSub] = catalog;
    const moduleNameById = new Map(catalog.map((module) => [module.id, module.name]));

    // Dos zonas raíz y una subzona, creadas por el editor inline.
    await createRootZone(page, ROOT);
    await createRootZone(page, OTHER);
    await createSubzone(page, ROOT, SUB_A);
    await createSubzone(page, OTHER, SUB_B);

    const created = await readGroups(sourceId);
    expect(hierarchy(created)).toEqual(
      [`1|${ROOT_LABEL}|${ROOT}`, `1|${ROOT_LABEL}|${OTHER}`, `2|${ROOT}|${SUB_A}`, `2|${OTHER}|${SUB_B}`].sort(),
    );

    const groupIdOf = (name: string) => created.find((group) => group.name === name)!.id;

    // Módulos en raíz, zonas y subzona.
    await addItem(page, sourceId, mRoot.id, null);
    const movedItemId = await addItem(page, sourceId, mA.id, groupIdOf(ROOT));
    await addItem(page, sourceId, mB.id, groupIdOf(OTHER));
    await addItem(page, sourceId, mPost.id, groupIdOf(SUB_B));
    await addItem(page, sourceId, mSub.id, groupIdOf(SUB_A));
    await page.reload();
    await expect(contents(page)).toContainText(mRoot.name);

    // Mover un módulo de zona a raíz conservando la misma instancia.
    await expand(page, ROOT);
    const moduleARow = moduleRow(childList(zoneRow(page, ROOT)), mA.name);
    await rowActions(moduleARow).getByRole("button", { name: "Mover de zona" }).click();
    const moveForm = moduleARow.locator(":scope > form.zone-editor");
    await moveForm.getByLabel(`Mover ${mA.name} a`).selectOption({ label: "Sin zona (raíz)" });
    await moveForm.getByRole("button", { name: "Mover aquí" }).click();
    await expect(moduleRow(rootList(page), mA.name)).toBeVisible();
    await expect
      .poll(async () => (await readItems(sourceId)).find((item) => item.id === movedItemId)?.group_id)
      .toBeNull();
    expect((await readItems(sourceId)).length, "mover no recrea la instancia").toBe(5);

    // Renombrar una zona.
    const otherRow = zoneRow(page, OTHER);
    await rowActions(otherRow).getByRole("button", { name: "Renombrar" }).click();
    const renameForm = otherRow.locator(":scope > form.zone-editor");
    await renameForm.getByLabel(`Nuevo nombre para ${OTHER}`).fill(RENAMED);
    await renameForm.getByRole("button", { name: "Guardar nombre" }).click();
    await expect(zoneToggle(page, RENAMED)).toBeVisible();

    // Eliminar una subzona con move_to_root: su módulo pasa a la raíz.
    await expand(page, RENAMED);
    const subBRow = zoneRow(page, SUB_B);
    await rowActions(subBRow).getByRole("button", { name: "Eliminar" }).click();
    const confirmSubB = subBRow.locator(":scope > .zone-confirm");
    await confirmSubB.getByRole("button", { name: "Mover contenido a la raíz y eliminar zona" }).click();
    await expect(zoneToggle(page, SUB_B)).toHaveCount(0);
    await expect(moduleRow(rootList(page), mPost.name)).toBeVisible();
    await expect
      .poll(async () => (await readItems(sourceId)).find((item) => item.module_id === mPost.id)?.group_id)
      .toBeNull();

    // Eliminar la otra zona con delete_contents: se borra su módulo.
    await expand(page, RENAMED);
    const renamedRow = zoneRow(page, RENAMED);
    await rowActions(renamedRow).getByRole("button", { name: "Eliminar" }).click();
    const confirmRenamed = renamedRow.locator(":scope > .zone-confirm");
    await confirmRenamed.getByRole("button", { name: "Eliminar zona y todo su contenido" }).click();
    await expect(zoneToggle(page, RENAMED)).toHaveCount(0);
    await expect
      .poll(async () => (await readItems(sourceId)).some((item) => item.module_id === mB.id))
      .toBe(false);

    // Estado final del evento fuente: dos niveles, módulos en raíz y subzona.
    const sourceGroups = await readGroups(sourceId);
    const sourceItems = await readItems(sourceId);
    expect(hierarchy(sourceGroups)).toEqual(
      [`1|${ROOT_LABEL}|${ROOT}`, `2|${ROOT}|${SUB_A}`].sort(),
    );
    expect(placement(sourceItems, sourceGroups, moduleNameById)).toEqual(
      [
        `${mRoot.name}@${ROOT_LABEL}`,
        `${mA.name}@${ROOT_LABEL}`,
        `${mPost.name}@${ROOT_LABEL}`,
        `${mSub.name}@${SUB_A}`,
      ].sort(),
    );

    // Guardar como plantilla privada.
    const templateName = `Plantilla zonas ${randomUUID().slice(0, 8)}`;
    const saveRegion = page.getByRole("region", { name: "Plantilla", exact: true });
    await saveRegion.getByRole("button", { name: "Guardar como plantilla" }).click();
    await saveRegion.getByLabel("Nombre de la plantilla").fill(templateName);
    await saveRegion.getByRole("button", { name: "Guardar plantilla" }).click();
    await expect(saveRegion.getByRole("status")).toContainText(`Plantilla "${templateName}" guardada.`);

    const template = await admin
      .from("event_templates")
      .select("id, name")
      .eq("owner_id", userId!)
      .eq("name", templateName)
      .single<TemplateRow>();
    if (template.error) throw template.error;

    const templateGroups = await readTemplateGroups(template.data.id);
    const templateItems = await readTemplateItems(template.data.id);
    expect(hierarchy(templateGroups)).toEqual(hierarchy(sourceGroups));
    expect(placement(templateItems, templateGroups, moduleNameById)).toEqual(
      placement(sourceItems, sourceGroups, moduleNameById),
    );
    expect(new Set([...sourceGroups.map((g) => g.id), ...templateGroups.map((g) => g.id)]).size).toBe(
      sourceGroups.length + templateGroups.length,
    );
    expect(new Set([...sourceItems.map((i) => i.id), ...templateItems.map((i) => i.id)]).size).toBe(
      sourceItems.length + templateItems.length,
    );

    // Instanciar un segundo evento desde la plantilla.
    await page.getByRole("link", { name: "← Eventos" }).click();
    await expect(page).toHaveURL(/\/packages$/);
    const templates = page.getByRole("region", { name: "Plantillas", exact: true });
    await templates.getByRole("button", { name: `Usar plantilla ${templateName}` }).click();
    const useForm = templates.getByRole("form", { name: `Crear evento desde ${templateName}` });
    await useForm.getByLabel("Nombre del evento").fill("Evento desde plantilla zonas");
    await useForm.getByRole("button", { name: "Crear evento" }).click();
    await expect(page).toHaveURL(PACKAGE_URL);
    const secondId = eventId(page);
    expect(secondId).not.toBe(sourceId);

    // Jerarquía y ubicaciones copiadas con identificadores nuevos.
    const secondGroups = await readGroups(secondId);
    const secondItems = await readItems(secondId);
    expect(hierarchy(secondGroups)).toEqual(hierarchy(sourceGroups));
    expect(placement(secondItems, secondGroups, moduleNameById)).toEqual(
      placement(sourceItems, sourceGroups, moduleNameById),
    );
    expect(new Set([...sourceGroups.map((g) => g.id), ...secondGroups.map((g) => g.id)]).size).toBe(
      sourceGroups.length + secondGroups.length,
    );
    expect(new Set([...sourceItems.map((i) => i.id), ...secondItems.map((i) => i.id)]).size).toBe(
      sourceItems.length + secondItems.length,
    );

    // Independencia: renombrar en la copia no toca origen ni plantilla.
    const secondRootRow = zoneRow(page, ROOT);
    await rowActions(secondRootRow).getByRole("button", { name: "Renombrar" }).click();
    const secondRename = secondRootRow.locator(":scope > form.zone-editor");
    await secondRename.getByLabel(`Nuevo nombre para ${ROOT}`).fill(EDITED);
    await secondRename.getByRole("button", { name: "Guardar nombre" }).click();
    await expect(zoneToggle(page, EDITED)).toBeVisible();

    const sourceAfter = await readGroups(sourceId);
    const templateAfter = await readTemplateGroups(template.data.id);
    expect(sourceAfter.some((group) => group.name === EDITED)).toBe(false);
    expect(templateAfter.some((group) => group.name === EDITED)).toBe(false);
    expect(sourceAfter.some((group) => group.name === ROOT)).toBe(true);
    expect(templateAfter.some((group) => group.name === ROOT)).toBe(true);
    expect(hierarchy(sourceAfter)).toEqual(hierarchy(sourceGroups));
    expect(hierarchy(templateAfter)).toEqual(hierarchy(sourceGroups));
  });
});
