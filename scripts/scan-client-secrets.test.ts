import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { force: true, recursive: true }));
});

describe("client secret scan", () => {
  it("acepta artefactos cliente sin secretos", () => {
    const directory = mkdtempSync(join(tmpdir(), "decorar-secret-scan-"));
    directories.push(directory);
    writeFileSync(join(directory, "clean.js"), 'const publicKey = "sb_publishable_example";');

    expect(() =>
      execFileSync(process.execPath, ["scripts/scan-client-secrets.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLIENT_STATIC_DIR: directory,
          SUPABASE_SERVICE_ROLE_KEY: "SERVICE_ROLE_SENTINEL",
          CLOUDINARY_URL: "cloudinary://CLOUDINARY_SENTINEL",
        },
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("rechaza un secreto presente en un artefacto cliente", () => {
    const directory = mkdtempSync(join(tmpdir(), "decorar-secret-scan-"));
    directories.push(directory);
    writeFileSync(join(directory, "leak.js"), 'const leaked = "SERVICE_ROLE_SENTINEL";');

    expect(() =>
      execFileSync(process.execPath, ["scripts/scan-client-secrets.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLIENT_STATIC_DIR: directory,
          SUPABASE_SERVICE_ROLE_KEY: "SERVICE_ROLE_SENTINEL",
          CLOUDINARY_URL: "cloudinary://CLOUDINARY_SENTINEL",
        },
        stdio: "pipe",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY leaked into client artifact/);
  });
});
