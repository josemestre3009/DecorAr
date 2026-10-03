import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const APP_ROOT = resolve("src/app");

/** Grupos de ruta que declaran si sus páginas exigen sesión. */
const ACCESS_GROUPS = ["(public)", "(protected)"];

async function findPages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(directory, entry.name);

      return entry.isDirectory() ? findPages(full) : entry.name === "page.tsx" ? [full] : [];
    }),
  );

  return nested.flat();
}

function toRoute(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, "/");
}

describe("inventario de rutas de página", () => {
  it("coloca cada página en el grupo que declara su acceso", async () => {
    const routes = (await findPages(APP_ROOT)).map(toRoute).sort();

    expect(routes.length).toBeGreaterThan(0);

    // La portada cuelga de la raíz y es pública por definición. Cualquier otra
    // página debe declarar su acceso en un grupo: sin grupo, `src/proxy.ts` la
    // protege y el layout `(protected)` no la revalida, y quedaría a medias.
    const sinGrupo = routes.filter(
      (route) => route !== "src/app/page.tsx" && !ACCESS_GROUPS.some((g) => route.includes(`/${g}/`)),
    );

    expect(sinGrupo).toEqual([]);
  });
});