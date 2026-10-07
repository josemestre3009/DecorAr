import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { collectImports, isProductionSource, resolveSpecifier } from "../../../scripts/scan-architecture";

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return sources(full);
      return Promise.resolve(isProductionSource(entry.name) ? [full] : []);
    }),
  );
  return nested.flat();
}

async function importsOf(root: string) {
  const files = await sources(resolve(root));
  return Promise.all(
    files.map(async (file) => {
      const path = relative(process.cwd(), file).replace(/\\/g, "/");
      return { imports: collectImports(await readFile(file, "utf8"), path), path };
    }),
  );
}

describe("event outbox boundaries", () => {
  it.each(["src/modules/events/domain", "src/modules/events/application", "src/modules/packages"])(
    "%s does not import Supabase or the budget module",
    async (root) => {
      const offending = (await importsOf(root)).flatMap(({ imports, path }) =>
        imports
          .filter(({ specifier }) => {
            const target = resolveSpecifier(path, specifier) ?? "";
            return (
              specifier.startsWith("@supabase/") ||
              target.startsWith("src/infrastructure") ||
              target.startsWith("src/modules/budget")
            );
          })
          .map(({ specifier }) => `${path} -> ${specifier}`),
      );

      expect(offending).toEqual([]);
    },
  );

  it("Supabase outbox adapters are server-only", async () => {
    for (const file of [
      "src/modules/events/infrastructure/supabase-event-outbox.ts",
      "src/modules/events/infrastructure/supabase-broadcast-event-publisher.ts",
    ]) {
      const imports = collectImports(await readFile(resolve(file), "utf8"), file);
      expect(imports[0]).toEqual({ kind: "static", specifier: "server-only" });
    }
  });

  it("the publisher never subscribes to postgres_changes", async () => {
    const code = await readFile(
      resolve("src/modules/events/infrastructure/supabase-broadcast-event-publisher.ts"),
      "utf8",
    );

    expect(code).not.toMatch(/["']postgres_changes["']/);
    expect(code).toContain("private: true");
  });
});
