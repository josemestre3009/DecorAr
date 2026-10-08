import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { collectImports, isProductionSource, resolveSpecifier } from "./scan-architecture";

/**
 * DECOR-30: the service role is server-only. Complements the post-build scan
 * (scripts/scan-client-secrets.mjs), which proves the value is absent from the
 * shipped bundle, by proving that no browser entry point can reach the admin
 * client or the variable through its import graph.
 */
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

const toRepoPath = (file: string) => relative(process.cwd(), file).replace(/\\/g, "/");

function resolveFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(resolve(candidate))) return candidate;
  }
  return null;
}

async function clientGraph(entry: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);

    const code = await readFile(resolve(path), "utf8");
    for (const { specifier } of collectImports(code, path)) {
      const target = resolveSpecifier(path, specifier);
      const file = target ? resolveFile(target) : null;
      if (file) pending.push(file);
    }
  }

  return seen;
}

describe("service role boundary", () => {
  it("ningún módulo cliente alcanza el cliente admin ni la service role", async () => {
    const files = (await walk(resolve("src"))).map(toRepoPath);
    const clientEntries = [BROWSER_FACTORY];

    for (const file of files) {
      if (/^\s*["']use client["']/.test(await readFile(resolve(file), "utf8"))) clientEntries.push(file);
    }

    expect(clientEntries.length).toBeGreaterThan(1);

    for (const entry of clientEntries) {
      const graph = await clientGraph(entry);
      expect([...graph], `${entry} reaches the admin client`).not.toContain(ADMIN_MODULE);

      for (const file of graph) {
        const code = await readFile(resolve(file), "utf8");
        expect(code, `${file} (client graph of ${entry})`).not.toContain("createAdminClient");
        // src/lib/env.ts is shared and names the variable inside
        // getAdminSupabaseEnv(); only a static `process.env.X` read could be
        // inlined by Next.js, so that is what must never appear client-side.
        expect(code, `${file} (client graph of ${entry})`).not.toMatch(
          /process\.env\.SUPABASE_SERVICE_ROLE_KEY/,
        );
      }
    }
  });

  it("el cliente admin es server-only", async () => {
    const imports = collectImports(await readFile(resolve(ADMIN_MODULE), "utf8"), ADMIN_MODULE);

    expect(imports[0]).toEqual({ kind: "static", specifier: "server-only" });
  });

  it("la service role nunca usa el prefijo NEXT_PUBLIC_", async () => {
    const sources = [
      ...(await walk(resolve("src"))),
      ...(await walk(resolve("scripts"))),
    ].map(toRepoPath);
    const config = [".env.example", "compose.yaml", "Dockerfile", "next.config.ts"].filter((file) =>
      existsSync(resolve(file)),
    );

    for (const file of [...sources, ...config]) {
      const code = await readFile(resolve(file), "utf8");
      expect(code, file).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/);
      expect(code, file).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);
    }
  });
});
